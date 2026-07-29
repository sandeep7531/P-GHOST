"""
👻 GHOST — Groq Cloud Client
─────────────────────────────
Fast cloud AI for technical/coding questions.
Uses Llama 3.3 70B via Groq's free tier.
"""

import os
import time
from typing import Callable
from groq import Groq
from dotenv import load_dotenv

# Load API key from .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_MAX_TOKENS = 800
GROQ_TEMPERATURE = 0.7


class GroqClient:
    """Streaming client for Groq API."""

    def __init__(self):
        self.enabled = bool(GROQ_API_KEY)
        if self.enabled:
            self.client = Groq(api_key=GROQ_API_KEY)
            print(f"☁️  Groq client ready (model: {GROQ_MODEL})")
        else:
            self.client = None
            print("⚠️  Groq disabled — GROQ_API_KEY not found in .env")

    def is_available(self) -> bool:
        return self.enabled

    def stream(self, prompt: str, on_token: Callable[[str], None],
               max_tokens: int = None) -> tuple:
        """
        Stream tokens from Groq.
        Returns: (full_answer, duration_seconds, first_token_seconds)
        """
        if not self.enabled:
            raise RuntimeError("Groq not configured")

        start = time.time()
        first_token_time = None
        full_answer = ""
        num_tokens = max_tokens if max_tokens is not None else GROQ_MAX_TOKENS

        try:
            stream = self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=GROQ_TEMPERATURE,
                max_tokens=num_tokens,
                stream=True,
            )

            for chunk in stream:
                delta = chunk.choices[0].delta
                token = delta.content or ""
                if token:
                    if first_token_time is None:
                        first_token_time = time.time() - start
                    full_answer += token
                    on_token(token)

        except Exception as e:
            print(f"❌ Groq error: {e}")
            raise

        duration = time.time() - start
        return full_answer, duration, (first_token_time or 0)