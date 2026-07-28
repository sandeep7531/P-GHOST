# 👻 Ghost — AI Interview Assistant

A **100% local, invisible AI interview assistant** for macOS. Listens to interviewer questions from Zoom/Meet/Teams and provides personalized answers based on your resume — all invisible to screen share.

Built with love ❤️ by Sandeep Rai

## ✨ Features

- 🎧 Real-time audio capture from meeting apps (BlackHole)
- 🧠 Local speech-to-text (MLX-Whisper on Apple Silicon)
- 🤖 Local AI (Ollama + Mistral 7B) — no OpenAI, no cloud
- 👻 Invisible to screen share & screenshots (`setContentProtection`)
- 📄 Personalized answers using YOUR resume + job description
- ⌨️ Global keyboard shortcuts
- 💬 Chat box question support (Cmd+Shift+Q)
- ✏️ Edit misheard questions before AI answers
- 🎨 Beautiful Electron + React overlay UI
- 🔒 100% offline — zero data leaves your Mac

## 🏗️ Tech Stack

- **Frontend:** Electron + React + TypeScript + Vite + Zustand
- **Audio:** BlackHole 2ch loopback driver
- **STT:** MLX-Whisper (Apple Silicon optimized)
- **LLM:** Ollama + Mistral 7B (4-bit quantized)
- **Communication:** WebSocket (Python ↔ Electron)

## 📦 Prerequisites

- macOS with Apple Silicon (M1/M2/M3)
- 16GB+ RAM
- Homebrew installed

## 🚀 Setup

### 1. Install dependencies

```bash
# Audio loopback
brew install blackhole-2ch

# Python
brew install python@3.11

# Ollama
brew install ollama
brew services start ollama

# ffmpeg (for Whisper)
brew install ffmpeg