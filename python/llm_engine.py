"""
👻 GHOST — Smart LLM Engine (v3 — Speed Optimized)
─────────────────────────────────────────────────────
Design goals:
  1. Real-time answers (< 3s to first token)
  2. Personalized (uses resume + JD + company context)
  3. Natural speaking tone (like senior engineer)
  4. Handles all interview types dynamically
  5. Remembers conversation history for follow-ups
  6. Correct technical answers (no hallucination)
"""

import json
import time
import requests
from typing import Callable


# ============================================================
# ⚙️ CONFIGURATION
# ============================================================
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "mistral:7b-instruct-q4_K_M"

MAX_HISTORY = 3
MAX_TOKENS = 600
TEMPERATURE = 0.5
KEEP_ALIVE = "30m"
NUM_CTX = 4096
NUM_THREAD = 8

RESUME_MAX_CHARS = 1500
JD_MAX_CHARS = 500
HISTORY_ANSWER_MAX_CHARS = 250


# ============================================================
# 📜 CONVERSATION HISTORY
# ============================================================
class HistoryManager:
    def __init__(self):
        self.history = []

    def add(self, question: str, answer: str):
        self.history.append({"q": question, "a": answer})
        if len(self.history) > MAX_HISTORY:
            self.history.pop(0)

    def get_last(self):
        return self.history[-1] if self.history else None

    def clear(self):
        self.history.clear()


# ============================================================
# 🤖 OLLAMA CLIENT
# ============================================================
class OllamaClient:
    def __init__(self, model=OLLAMA_MODEL, url=OLLAMA_URL):
        self.model = model
        self.url = url

    def stream(self, prompt: str, on_token: Callable[[str], None]) -> tuple:
        start = time.time()
        first_token_time = None
        full_answer = ""

        try:
            response = requests.post(
                self.url,
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": True,
                    "keep_alive": KEEP_ALIVE,
                    "options": {
                        "temperature": TEMPERATURE,
                        "top_p": 0.9,
                        "num_predict": MAX_TOKENS,
                        "num_ctx": NUM_CTX,
                        "num_thread": NUM_THREAD,
                        "stop": ["\n\n\n\n", "Interviewer:", "\nQ:", "\n===", "END OF ANSWER"]
                    }
                },
                stream=True,
                timeout=90
            )

            for line in response.iter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    token = data.get("response", "")
                    if token:
                        if first_token_time is None:
                            first_token_time = time.time() - start
                        full_answer += token
                        on_token(token)
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue

        except Exception as e:
            print(f"❌ Ollama error: {e}")
            raise

        duration = time.time() - start
        return full_answer, duration, (first_token_time or 0)

    def warm_up(self):
        try:
            print("🔥 Warming up Ollama model...")
            requests.post(
                self.url,
                json={
                    "model": self.model,
                    "prompt": "hi",
                    "stream": False,
                    "keep_alive": KEEP_ALIVE,
                    "options": {"num_predict": 5}
                },
                timeout=30
            )
            print("✅ Model warm and ready")
        except Exception as e:
            print(f"⚠️ Warm-up skipped: {e}")


# ============================================================
# 🎯 PROMPT BUILDER
# ============================================================
class PromptBuilder:
    def __init__(self, session_context: dict, history: HistoryManager):
        self.context = session_context
        self.history = history

    def build(self, question: str) -> str:
        resume = self.context.get('resume', '').strip()
        if resume:
            resume_short = resume[:RESUME_MAX_CHARS]
            identity = f"YOUR RESUME (this is TRUTH about you):\n{resume_short}"
        else:
            identity = "You are an experienced senior software engineer."

        target = ""
        company = self.context.get('company', '').strip()
        position = self.context.get('position', '').strip()
        jd = self.context.get('job_description', '').strip()

        if company and position:
            target = f"\n\nApplying for: {position} at {company}"
            if jd:
                target += f"\nJD: {jd[:JD_MAX_CHARS]}"

        history_block = ""
        if self.history.history and self._looks_like_followup(question):
            last = self.history.history[-1]
            answer_snippet = last['a'][:HISTORY_ANSWER_MAX_CHARS]
            history_block = (
                f"\n\nPREVIOUS Q: {last['q']}\n"
                f"PREVIOUS A: {answer_snippet}...\n"
                f"(Current question CONTINUES this topic)"
            )

        rules = """
You are in a LIVE interview speaking OUT LOUD.

RULES:
- NO filler openings ("Hi!", "Sure!", "Great question!", "Thank you...")
- Start DIRECTLY with the answer

TYPO CORRECTIONS (speech-to-text errors — interpret intent):
- "fallback" often means "BACKOFF" in retry context
- "dbouncing"/"deboucing" = "debouncing"
- "throtling" = "throttling"
- "microservise" = "microservices"
- "reactjs hoks" = "React hooks"
- "async awit" = "async/await"
- "memoize" not "memorize"
- "polyfill" not "polyfil"
- Read context — if user asks about "exponential fallback" for retries,
  they mean EXPONENTIAL BACKOFF (delays doubling on each retry).

TECHNICAL ACCURACY:
- Give industry-standard correct answers
- Debounce = delay execution until user stops
- Throttle = limit execution to once per time window
- Exponential backoff = retry with delays growing exponentially (1s, 2s, 4s, 8s...)
- Circuit breaker = stop trying after N failures
- Code must be COMPLETE and WORKING (never cut off mid-function)

FOR CODING QUESTIONS SPECIFICALLY:
- Always write COMPLETE, runnable code
- Include function signature, body, and closing braces
- Add usage example after the function
- Explain in 1-2 sentences after the code
- Use TypeScript/JavaScript unless another language specified

- Use YOUR RESUME facts for personal questions (NEVER invent)
- Adaptive length: simple Q = 1-2 sentences, concept = 40-70 words,
  code = COMPLETE working code, "list all" = comprehensive coverage
- First person, contractions ("I've", "we're"), sound HUMAN
- Format: paragraph for stories, bullets (•) for lists, code blocks for code
- Never say "I don't know" — always give best confident answer"""

        return f"""{identity}{target}{history_block}
{rules}

Interviewer just asked: "{question}"

Your response (start with answer, no filler):"""

    def _looks_like_followup(self, question: str) -> bool:
        q = question.lower().strip()
        word_count = len(question.split())

        followup_words = [
            'that', 'it', 'this', 'them', 'those',
            'more', 'explain', 'elaborate', 'continue', 'why',
            'how so', 'like what', 'such as', 'and then'
        ]

        chain_commands = [
            'write code', 'show code', 'code it', 'code that',
            'implement it', 'example', 'go on', 'continue',
            'why', 'how', 'when'
        ]

        if word_count < 10 and any(w in q for w in followup_words):
            return True

        if q in chain_commands or any(q.startswith(c) for c in chain_commands):
            return True

        if word_count <= 3:
            return True

        return False


# ============================================================
# 🎯 MAIN LLM ENGINE
# ============================================================
class GhostLLM:
    def __init__(self):
        self.history = HistoryManager()
        self.ollama = OllamaClient()
        self.session_context = {
            "resume": "",
            "company": "",
            "position": "",
            "job_description": "",
            "loaded": False
        }
        self.ollama.warm_up()

    def load_session(self, resume: str, company: str, position: str, job_description: str):
        self.session_context = {
            "resume": resume,
            "company": company,
            "position": position,
            "job_description": job_description,
            "loaded": True
        }
        self.history.clear()
        print(f"\n{'='*60}")
        print(f"📥 SESSION LOADED")
        print(f"   Company: {company}")
        print(f"   Position: {position}")
        print(f"   Resume: {len(resume)} chars (using first {RESUME_MAX_CHARS})")
        print(f"   JD: {len(job_description)} chars (using first {JD_MAX_CHARS})")
        print(f"{'='*60}\n")

    def clear_session(self):
        self.session_context = {
            "resume": "", "company": "", "position": "",
            "job_description": "", "loaded": False
        }
        self.history.clear()
        print("🗑️ Session cleared")

    def generate(self, question: str,
                 on_start: Callable[[dict], None],
                 on_token: Callable[[str], None],
                 on_done: Callable[[dict], None],
                 on_error: Callable[[str], None]):
        try:
            print(f"\n💬 Question: {question}")

            builder = PromptBuilder(self.session_context, self.history)
            prompt = builder.build(question)

            prompt_size = len(prompt)
            prompt_tokens = prompt_size // 4
            print(f"📏 Prompt: {prompt_size} chars (~{prompt_tokens} tokens)")

            on_start({
                "question": question,
                "mode": "smart",
                "is_follow_up": len(self.history.history) > 0
            })

            full_answer, duration, first_token = self.ollama.stream(prompt, on_token)

            if full_answer.strip():
                self.history.add(question, full_answer)

            word_count = len(full_answer.split())
            speed = word_count / duration if duration > 0 else 0
            print(f"\n✅ Done in {duration:.2f}s | first_token={first_token:.2f}s | "
                  f"{word_count} words | {speed:.1f} w/s")

            on_done({
                "full_answer": full_answer,
                "duration": duration,
                "mode": "smart",
                "word_count": word_count,
                "is_follow_up": len(self.history.history) > 1
            })

        except Exception as e:
            print(f"❌ LLM error: {e}")
            on_error(str(e))