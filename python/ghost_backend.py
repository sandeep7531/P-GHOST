"""
👻 GHOST — Backend Service (Audio + WebSocket Orchestrator)
────────────────────────────────────────────────────────────
Handles:
  - Audio capture from BlackHole
  - VAD (voice activity detection)
  - Whisper transcription
  - WebSocket server (Electron overlay ↔ this backend)
  - Pause/Resume via keyboard shortcuts

All LLM logic lives in `llm_engine.py`.
"""

import sounddevice as sd
import numpy as np
import mlx_whisper
import webrtcvad
import queue
import threading
import time
import json
import asyncio
import websockets
import logging
import os
import tempfile
from scipy.io.wavfile import write

from llm_engine import GhostLLM


# ============================================================
# 🔇 SILENCE WEBSOCKET HANDSHAKE NOISE
# ============================================================
class HandshakeErrorFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        noise_keywords = [
            'opening handshake failed',
            'did not receive a valid HTTP request',
            'connection closed while reading HTTP request line',
            'stream ends after 0 bytes'
        ]
        return not any(kw in msg for kw in noise_keywords)


ws_logger = logging.getLogger('websockets.server')
ws_logger.addFilter(HandshakeErrorFilter())
ws_logger.setLevel(logging.ERROR)
logging.getLogger('asyncio').setLevel(logging.WARNING)


# ============================================================
# ⚙️ CONFIGURATION
# ============================================================
SAMPLE_RATE = 16000
CHANNELS = 1
FRAME_DURATION_MS = 30
FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)
SILENCE_THRESHOLD_MS = 1000
MIN_SPEECH_MS = 500
MAX_SPEECH_MS = 15000
VAD_AGGRESSIVENESS = 2

WHISPER_MODEL = "mlx-community/whisper-small-mlx-q4"

WEBSOCKET_HOST = "localhost"
WEBSOCKET_PORT = 8765


# ============================================================
# 🎯 GLOBAL STATE
# ============================================================
is_paused = False   # When True, audio processing is paused


# ============================================================
# 🎯 INITIALIZE LLM ENGINE (single instance for whole app)
# ============================================================
llm = GhostLLM()


# ============================================================
# 📡 WEBSOCKET BROADCASTER
# ============================================================
class Broadcaster:
    """Manages WebSocket connections and broadcasts messages to all clients."""

    def __init__(self):
        self.clients = set()
        self.loop = None

    def set_loop(self, loop):
        self.loop = loop

    async def register(self, websocket):
        self.clients.add(websocket)
        print(f"🔌 Client connected. Total: {len(self.clients)}")

    async def unregister(self, websocket):
        self.clients.discard(websocket)
        print(f"❌ Client disconnected. Total: {len(self.clients)}")

    async def broadcast(self, message: dict):
        if not self.clients:
            return
        payload = json.dumps(message)
        dead = set()
        for ws in self.clients:
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.clients.discard(ws)

    def send_from_thread(self, message: dict):
        """Thread-safe way to broadcast from non-async code."""
        if self.loop and self.clients:
            asyncio.run_coroutine_threadsafe(
                self.broadcast(message), self.loop
            )


broadcaster = Broadcaster()


# ============================================================
# 🔗 LLM CALLBACK BRIDGE
# ============================================================
def run_llm(question: str):
    """
    Kick off an LLM generation in a background thread and stream
    all output back to the overlay via the broadcaster.
    """
    threading.Thread(
        target=lambda: llm.generate(
            question,
            on_start=lambda info: broadcaster.send_from_thread({
                "type": "answer_start",
                **info
            }),
            on_token=lambda tok: broadcaster.send_from_thread({
                "type": "answer_token",
                "token": tok
            }),
            on_done=lambda info: broadcaster.send_from_thread({
                "type": "answer_done",
                **info
            }),
            on_error=lambda msg: broadcaster.send_from_thread({
                "type": "error",
                "message": msg
            })
        ),
        daemon=True
    ).start()


# ============================================================
# 🎧 AUDIO CAPTURE + VAD + WHISPER
# ============================================================
class AudioListener:
    def __init__(self, device_index):
        self.device_index = device_index
        self.vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
        self.audio_queue = queue.Queue()
        self.speech_buffer = []
        self.silence_frames = 0
        self.silence_threshold_frames = int(SILENCE_THRESHOLD_MS / FRAME_DURATION_MS)
        self.min_speech_frames = int(MIN_SPEECH_MS / FRAME_DURATION_MS)
        self.max_speech_frames = int(MAX_SPEECH_MS / FRAME_DURATION_MS)
        self.is_speaking = False
        self.running = False
        self.preload_whisper()

    def preload_whisper(self):
        """Warm up Whisper so first real transcription is fast."""
        print("🧠 Warming up Whisper...")
        silence = np.zeros(SAMPLE_RATE, dtype=np.float32)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
        write(temp_path, SAMPLE_RATE, (silence * 32767).astype(np.int16))
        _ = mlx_whisper.transcribe(temp_path, path_or_hf_repo=WHISPER_MODEL)
        os.remove(temp_path)
        print("✅ Whisper ready")

    def transcribe(self, audio_np):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
        write(temp_path, SAMPLE_RATE, (audio_np * 32767).astype(np.int16))
        try:
            result = mlx_whisper.transcribe(
                temp_path,
                path_or_hf_repo=WHISPER_MODEL,
                language="en"
            )
            return result["text"].strip()
        finally:
            os.remove(temp_path)

    def audio_callback(self, indata, frames, time_info, status):
        if status:
            print(f"⚠️ Audio: {status}")
        self.audio_queue.put(indata.copy())

    def is_speech(self, frame):
        pcm = (frame * 32767).astype(np.int16).tobytes()
        try:
            return self.vad.is_speech(pcm, SAMPLE_RATE)
        except Exception:
            return False

    def process_audio(self):
        while self.running:
            try:
                chunk = self.audio_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            # ⏸️ Skip processing entirely when paused
            if is_paused:
                # Drain queue so buffer doesn't grow while paused
                self.speech_buffer = []
                self.silence_frames = 0
                self.is_speaking = False
                continue

            flat = chunk.flatten()
            num_frames = len(flat) // FRAME_SIZE

            for i in range(num_frames):
                frame = flat[i * FRAME_SIZE:(i + 1) * FRAME_SIZE]

                if self.is_speech(frame):
                    if not self.is_speaking:
                        print("🎙️  Speech started...")
                        self.is_speaking = True
                        broadcaster.send_from_thread({"type": "listening"})
                    self.speech_buffer.append(frame)
                    self.silence_frames = 0

                    if len(self.speech_buffer) >= self.max_speech_frames:
                        print("⏱️ Max length reached, finalizing...")
                        self._finalize_speech()
                else:
                    if self.is_speaking:
                        self.silence_frames += 1
                        self.speech_buffer.append(frame)
                        if self.silence_frames >= self.silence_threshold_frames:
                            self._finalize_speech()

    def _finalize_speech(self):
        # ⏸️ Skip if paused
        if is_paused:
            print("⏸️  Listening paused, ignoring speech")
            self._reset()
            return

        if len(self.speech_buffer) < self.min_speech_frames:
            print(f"⏭️  Skipping short segment")
            self._reset()
            return

        audio_np = np.concatenate(self.speech_buffer)
        duration = len(audio_np) / SAMPLE_RATE
        print(f"🧠 Transcribing {duration:.2f}s...")

        start = time.time()
        text = self.transcribe(audio_np)
        elapsed = time.time() - start

        if text and len(text) > 3:
            print(f"\n📝 [{elapsed:.2f}s] {text}\n")

            broadcaster.send_from_thread({
                "type": "transcript",
                "text": text,
                "duration": duration
            })

            # Kick off LLM generation
            run_llm(text)

        self._reset()

    def _reset(self):
        self.speech_buffer = []
        self.silence_frames = 0
        self.is_speaking = False

    def start(self):
        self.running = True
        threading.Thread(target=self.process_audio, daemon=True).start()

        print(f"\n🎧 Audio capture started on device {self.device_index}")

        with sd.InputStream(
            device=self.device_index,
            channels=CHANNELS,
            samplerate=SAMPLE_RATE,
            dtype='float32',
            blocksize=FRAME_SIZE,
            callback=self.audio_callback
        ):
            while self.running:
                time.sleep(0.5)


# ============================================================
# 📡 WEBSOCKET HANDLER
# ============================================================
async def websocket_handler(websocket):
    global is_paused
    await broadcaster.register(websocket)
    try:
        # Initial hello
        await websocket.send(json.dumps({
            "type": "connected",
            "message": "Ghost backend connected",
            "context_loaded": llm.session_context["loaded"],
            "is_paused": is_paused
        }))

        # Listen for messages from Electron
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                # ─────────────────────────────────
                # 📥 LOAD SESSION CONTEXT
                # ─────────────────────────────────
                if msg_type == "load_session":
                    llm.load_session(
                        resume=data.get("resume", ""),
                        company=data.get("company", ""),
                        position=data.get("position", ""),
                        job_description=data.get("job_description", "")
                    )
                    await websocket.send(json.dumps({
                        "type": "session_loaded",
                        "message": f"Ready for {data.get('position', '')} at {data.get('company', '')}"
                    }))

                # ─────────────────────────────────
                # 🗑️ CLEAR SESSION
                # ─────────────────────────────────
                elif msg_type == "clear_session":
                    llm.clear_session()

                # ─────────────────────────────────
                # 💬 CHAT QUESTION (clipboard/test box/edit)
                # ─────────────────────────────────
                elif msg_type == "chat_question":
                    question = data.get("text", "")
                    print(f"\n💬 Chat question: {question}")
                    run_llm(question)

                # ─────────────────────────────────
                # 🎯 SET AI MODE (local/hybrid/cloud)
                # ─────────────────────────────────
                elif msg_type == "set_ai_mode":
                    mode = data.get("mode", "hybrid")
                    success = llm.set_ai_mode(mode)
                    await websocket.send(json.dumps({
                        "type": "ai_mode_changed",
                        "mode": mode,
                        "success": success
                    }))

                # ─────────────────────────────────
                # ⏸️ PAUSE LISTENING
                # ─────────────────────────────────
                elif msg_type == "pause_listening":
                    is_paused = True
                    print("⏸️  Audio listening PAUSED (chat questions still work)")

                # ─────────────────────────────────
                # ▶️ RESUME LISTENING
                # ─────────────────────────────────
                elif msg_type == "resume_listening":
                    is_paused = False
                    print("▶️  Audio listening RESUMED")

            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await broadcaster.unregister(websocket)


# ============================================================
# 🎤 FIND BLACKHOLE
# ============================================================
def find_blackhole():
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        if 'BlackHole' in d['name'] and d['max_input_channels'] > 0:
            return i
    return None


# ============================================================
# 🚀 MAIN
# ============================================================
async def main():
    print("👻 GHOST — Backend Service")
    print("=" * 60)

    device = find_blackhole()
    if device is None:
        print("❌ BlackHole not found!")
        return

    print(f"✅ BlackHole at index [{device}]")

    listener = AudioListener(device)

    broadcaster.set_loop(asyncio.get_event_loop())

    async with websockets.serve(websocket_handler, WEBSOCKET_HOST, WEBSOCKET_PORT):
        print(f"📡 WebSocket server listening on ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}")

        threading.Thread(target=listener.start, daemon=True).start()

        print("\n" + "=" * 60)
        print("✅ Ghost backend is READY")
        print("   1. Waiting for Electron overlay to connect...")
        print("   2. Session context will load from setup screen")
        print("   3. Play a YouTube video or use test box to trigger AI")
        print("   4. Press Ctrl+C to stop")
        print("=" * 60 + "\n")

        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")