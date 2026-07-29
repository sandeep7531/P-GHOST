"""
GHOST — Smart LLM Engine (v10 — Hybrid Local + Groq Cloud)
- Smart router: LOCAL for personal, CLOUD for technical
- Fallback to local if cloud fails
- User can switch modes: hybrid | local | cloud
"""

import json
import re
import time
import os
import requests
from typing import Callable
from groq_client import GroqClient

# ============================================================
# CONFIGURATION
# ============================================================
OLLAMA_URL = "http://localhost:11434/api/generate"
# OLLAMA_MODEL = "mistral:7b-instruct-q4_K_M"
OLLAMA_MODEL = "qwen2.5-coder:7b-instruct-q4_K_M"


MAX_HISTORY = 3
MAX_TOKENS = 600
TEMPERATURE = 0.7
KEEP_ALIVE = "40m"
NUM_CTX = 5096
NUM_THREAD = 8
REQUEST_TIMEOUT = 45

RESUME_MAX_CHARS = 5000
JD_MAX_CHARS = 1200
HISTORY_ANSWER_MAX_CHARS = 650

RULES_FILE = os.path.join(os.path.dirname(__file__), "rules.json")


# ============================================================
# RULES LOADER
# ============================================================
class RulesLoader:
    def __init__(self, rules_path=RULES_FILE):
        self.rules_path = rules_path
        self.rules = {}
        self.last_modified = 0
        self.load()

    def load(self):
        try:
            current_mtime = os.path.getmtime(self.rules_path)
            if current_mtime == self.last_modified:
                return False
            with open(self.rules_path, 'r', encoding='utf-8') as f:
                self.rules = json.load(f)
            self.last_modified = current_mtime
            print(f"Rules loaded (v{self.rules.get('version', '?')})")
            return True
        except FileNotFoundError:
            print(f"Rules file not found: {self.rules_path}")
            self.rules = {}
            return False
        except json.JSONDecodeError as e:
            print(f"Rules JSON invalid: {e}")
            return False

    def get(self, key, default=None):
        return self.rules.get(key, default)

    def build_rules_prompt(self):
        r = self.rules
        banned = r.get("banned_phrases", []) + r.get("banned_corporate_words", [])
        banned_str = ", ".join(f'"{b}"' for b in banned[:12])
        openings = ", ".join(f'"{b}"' for b in r.get("banned_openings", [])[:12])
        forbidden = "\n".join(f"- {f}" for f in r.get("forbidden_behaviors", []))
        style = "\n".join(f"- {s}" for s in r.get("required_style", []))
        typos = r.get("typo_corrections", {})
        typos_str = ", ".join(f'"{k}"->"{v}"' for k, v in list(typos.items())[:6])

        return f"""{r.get('critical_directive', '')}

FORBIDDEN:
{forbidden}

NEVER START WITH: {openings}
NEVER USE: {banned_str}

REQUIRED STYLE (ChatGPT-quality):
{style}

TYPO FIXES: {typos_str}"""


rules = RulesLoader()


# ============================================================
# CONVERSATION HISTORY
# ============================================================
class HistoryManager:
    def __init__(self):
        self.history = []

    def add(self, question, answer):
        self.history.append({"q": question, "a": answer})
        if len(self.history) > MAX_HISTORY:
            self.history.pop(0)

    def get_last(self):
        return self.history[-1] if self.history else None

    def clear(self):
        self.history.clear()


# ============================================================
# OLLAMA CLIENT
# ============================================================
class OllamaClient:
    def __init__(self, model=OLLAMA_MODEL, url=OLLAMA_URL):
        self.model = model
        self.url = url

    def stream(self, prompt, on_token, max_tokens=None):
        start = time.time()
        first_token_time = None
        full_answer = ""
        num_predict = max_tokens if max_tokens is not None else MAX_TOKENS

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
                        "num_predict": num_predict,
                        "num_ctx": NUM_CTX,
                        "num_thread": NUM_THREAD,
                        "stop": ["\n\n\n\n", "Interviewer:", "\nQ:", "END OF ANSWER"]
                    }
                },
                stream=True,
                timeout=REQUEST_TIMEOUT
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
            print(f"Ollama error: {e}")
            raise

        duration = time.time() - start
        return full_answer, duration, (first_token_time or 0)

    def warm_up(self):
        try:
            print("Warming up Ollama model...")
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
            print("Model warm and ready")
        except Exception as e:
            print(f"Warm-up skipped: {e}")


# ============================================================
# PROMPT BUILDER
# ============================================================
class PromptBuilder:
    def __init__(self, session_context, history):
        self.context = session_context
        self.history = history

    def build(self, question, question_type="concept"):
        rules.load()

        resume = self.context.get('resume', '').strip()
        if resume:
            resume_short = resume[:RESUME_MAX_CHARS]
            identity_intro = rules.get('identity_intro', 'YOU ARE THIS PERSON:')
            identity_outro = rules.get('identity_outro', 'Speak in first person.')
            identity = f"{identity_intro}\n\n{resume_short}\n\n{identity_outro}"
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

        rules_prompt = rules.build_rules_prompt()
        format_hint = self._get_format_hint(question_type, question)

        return f"""{identity}{target}{history_block}

{rules_prompt}
{format_hint}

CURRENT SITUATION:
You are the CANDIDATE in an interview.
The INTERVIEWER just asked you this question:

"{question}"

Answer with ChatGPT-quality structure and depth.
Start immediately with your answer content.

YOUR ANSWER:"""

    def _looks_like_followup(self, question):
        q = question.lower().strip()
        word_count = len(question.split())

        followup_words = [
            'that', 'it', 'this', 'them', 'those',
            'more', 'explain', 'elaborate', 'continue',
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

    def _get_format_hint(self, question_type, question):
        q_lower = question.lower()

        if question_type == "code_concept":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Concept + Code):",
                "",
                "[Opening paragraph: 2-3 sentences explaining WHAT it is and WHY it exists]",
                "",
                "**How it works:**",
                "- Key mechanism 1",
                "- Key mechanism 2",
                "- Key mechanism 3",
                "",
                "**Implementation:**",
                "Use a fenced code block with javascript tag showing complete working code",
                "",
                "**Usage:**",
                "Show a real-world usage example in another code block",
                "",
                "**Common use cases:**",
                "- Use case 1",
                "- Use case 2",
                "- Use case 3",
                "",
                "**When to use:** [1 sentence practical guidance]",
                "",
                "RULES:",
                "- Code MUST be complete and working",
                "- Use proper markdown fenced code blocks with javascript tag",
                "- Total answer 150-250 words (code doesn't count)"
            ])

        if question_type == "concept":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Concept + Optional Code):",
                "",
                "[Opening paragraph: 2-3 sentences explaining WHAT it is and its purpose]",
                "",
                "**Key characteristics:**",
                "- Characteristic 1 with brief explanation",
                "- Characteristic 2 with brief explanation",
                "- Characteristic 3 with brief explanation",
                "",
                "**Code example (IF the concept is programming-related):**",
                "```javascript",
                "// Show a clear, working example of the concept",
                "// This is REQUIRED for JS/React/programming topics",
                "```",
                "",
                "**When to use:** [1 sentence practical guidance]",
                "",
                "RULES:",
                "- Use bold for section headers",
                "- If topic is technical/programming — ALWAYS include code example",
                "- If topic is non-technical (like 'what is HTTP?') — code is optional",
                "- Keep total answer 100-200 words"
            ])

        comparison_triggers = [
            'difference between', 'differences between', 'compare',
            ' vs ', 'versus', 'pros and cons', 'when to use',
            'which is better', 'types of'
        ]
        if any(t in q_lower for t in comparison_triggers) or question_type == "comparison":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Comparison):",
                "",
                "[Brief opening: 1 sentence overview]",
                "",
                "**[Item 1 Name]**",
                "- Property 1",
                "- Property 2",
                "- Best for: [use case]",
                "",
                "**[Item 2 Name]**",
                "- Property 1",
                "- Property 2",
                "- Best for: [use case]",
                "",
                "**[Item 3 Name (if applicable)]**",
                "- Property 1",
                "- Property 2",
                "- Best for: [use case]",
                "",
                "**Bottom line:** [1-2 sentence recommendation]",
                "",
                "RULES:",
                "- Use bold for each item name",
                "- Include Best for: for each item",
                "- Total under 200 words"
            ])

        if question_type == "how_does":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Process Explanation):",
                "",
                "[Brief opening: 1-2 sentences setting context]",
                "",
                "**Step-by-step process:**",
                "1. First step happens because...",
                "2. Then this happens...",
                "3. Finally this results in...",
                "",
                "**Code example (IF programming topic — ALMOST ALWAYS REQUIRED):**",
                "```javascript",
                "// Working code showing HOW it works",
                "```",
                "",
                "**Example scenario:**",
                "[Concrete walk-through with real example]",
                "",
                "**Common gotchas:** [1-2 things to watch out for]",
                "",
                "RULES:",
                "- Use numbered list for sequential steps",
                "- For programming topics: ALWAYS include code",
                "- Total under 250 words"
            ])

        if question_type == "behavioral":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: STAR Story):",
                "",
                "**Situation:** [1-2 sentences setting real context from your resume]",
                "",
                "**Task:** [What needed to be accomplished — 1 sentence]",
                "",
                "**Action:** [What YOU did specifically]",
                "- Action step 1",
                "- Action step 2",
                "- Action step 3",
                "",
                "**Result:** [Specific outcome with metric]",
                "",
                "**Takeaway:** [1 sentence about what you learned]",
                "",
                "RULES:",
                "- Use ACTUAL company/project from your resume",
                "- Include SPECIFIC metric in Result",
                "- Total under 180 words"
            ])

        if question_type == "system_design":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: System Design):",
                "",
                "**Approach:**",
                "[1-2 sentences on the high-level strategy]",
                "",
                "**Key components:**",
                "- **Component 1:** [what it does]",
                "- **Component 2:** [what it does]",
                "- **Component 3:** [what it does]",
                "",
                "**Data flow:** Use code block showing User -> API -> Service -> Database",
                "",
                "**Scaling considerations:**",
                "- Bottleneck: [what to watch]",
                "- Solution: [how to handle scale]",
                "",
                "**Trade-offs:** [1 sentence on key trade-offs]",
                "",
                "RULES:",
                "- Bold each component name",
                "- Total under 250 words"
            ])

        if question_type == "coding":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Coding Solution):",
                "",
                "[Brief 1-2 sentence explanation of approach]",
                "",
                "**Implementation:**",
                "Use fenced code block with javascript tag containing complete working code",
                "",
                "**Usage example:**",
                "Another fenced code block showing how to use the function",
                "",
                "**Complexity:**",
                "- Time: O(?)",
                "- Space: O(?)",
                "",
                "**Edge cases to consider:**",
                "- Edge case 1",
                "- Edge case 2",
                "",
                "RULES:",
                "- Code MUST be complete and runnable",
                "- Use fenced code blocks with javascript tag",
                "- Always include complexity analysis"
            ])

        if question_type == "hr":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: HR Answer):",
                "",
                "Structure your answer as flowing prose (NO bullets):",
                "",
                "[Direct answer in first person, 2-4 sentences, referencing your",
                "actual resume experience and connecting to the role]",
                "",
                "[Optional 1-sentence forward-looking statement about the target company/role]",
                "",
                "RULES:",
                "- Flowing paragraph, NO bullet points",
                "- Reference ACTUAL companies from your resume",
                "- Total 60-90 words max"
            ])

        recap_triggers = ['list all', 'walk me through', 'tell me about all',
                          'summary of your', 'previous companies', 'work history']
        if any(t in q_lower for t in recap_triggers) or question_type == "recap":
            return '\n'.join([
                "FORMAT (ChatGPT-Style: Comprehensive List):",
                "",
                "[Brief opening: 1 sentence overview of your career]",
                "",
                "**[Company 1 Name]** — [Role, Duration]",
                "- Key achievement or responsibility",
                "- Notable metric or impact",
                "",
                "**[Company 2 Name]** — [Role, Duration]",
                "- Key achievement or responsibility",
                "- Notable metric or impact",
                "",
                "**[Company 3 Name]** — [Role, Duration]",
                "- Key achievement or responsibility",
                "- Notable metric or impact",
                "",
                "**Overall:** [1 sentence connecting to the target role]",
                "",
                "RULES:",
                "- Bold each company name",
                "- Cover ALL items from resume",
                "- Total under 250 words"
            ])

        # DEFAULT
        return '\n'.join([
            "FORMAT (ChatGPT-Style: Default Structure):",
            "",
            "[Opening paragraph: 2-3 sentences answering directly]",
            "",
            "**Key points:**",
            "- Point 1",
            "- Point 2",
            "- Point 3",
            "",
            "[Concrete example or takeaway: 1-2 sentences]",
            "",
            "RULES:",
            "- Use bold for key terms",
            "- Use bullets for lists",
            "- Total 100-150 words"
        ])


# ============================================================
# MAIN LLM ENGINE (v10 — Hybrid Local + Cloud)
# ============================================================
class GhostLLM:
    def __init__(self):
        self.history = HistoryManager()
        self.ollama = OllamaClient()
        self.groq = GroqClient()  # 🆕 Cloud client
        self.session_context = {
            "resume": "",
            "company": "",
            "position": "",
            "job_description": "",
            "loaded": False
        }
        self.is_generating = False
        self.ai_mode = "hybrid"  # 🆕 hybrid | local | cloud
        self.ollama.warm_up()

    # ─────────────────────────────────
    # 🎯 AI MODE MANAGEMENT
    # ─────────────────────────────────
    def set_ai_mode(self, mode):
        """Change AI routing mode: hybrid, local, or cloud."""
        if mode in ("hybrid", "local", "cloud"):
            self.ai_mode = mode
            print(f"🎯 AI mode set to: {mode}")
            return True
        return False

    def _pick_engine(self, question_type):
        """
        Smart router: LOCAL (Mistral) or CLOUD (Groq).

        Rules:
        - LOCAL always if user picked local mode
        - CLOUD always if user picked cloud mode (with fallback)
        - HYBRID: LOCAL for personal, CLOUD for technical
        - Fallback to LOCAL if Groq unavailable
        """
        # User forced local
        if self.ai_mode == "local":
            return "local"

        # User forced cloud (if available)
        if self.ai_mode == "cloud" and self.groq.is_available():
            return "cloud"

        # Hybrid mode: smart routing
        # Personal questions → LOCAL (privacy, uses resume heavily)
        if question_type in ("hr", "behavioral", "recap"):
            return "local"

        # Technical questions → CLOUD (10x faster + smarter)
        if question_type in ("code_concept", "concept", "comparison",
                             "coding", "system_design", "how_does"):
            return "cloud" if self.groq.is_available() else "local"

        # Default fallback → LOCAL
        return "local"

    # ─────────────────────────────────
    # SESSION MANAGEMENT
    # ─────────────────────────────────
    def load_session(self, resume, company, position, job_description):
        self.session_context = {
            "resume": resume,
            "company": company,
            "position": position,
            "job_description": job_description,
            "loaded": True
        }
        self.history.clear()
        print(f"\n{'='*60}")
        print(f"SESSION LOADED")
        print(f"   Company: {company}")
        print(f"   Position: {position}")
        print(f"   Resume: {len(resume)} chars (using first {RESUME_MAX_CHARS})")
        print(f"   JD: {len(job_description)} chars (using first {JD_MAX_CHARS})")
        print(f"   AI Mode: {self.ai_mode}")
        print(f"{'='*60}\n")

    def clear_session(self):
        self.session_context = {
            "resume": "", "company": "", "position": "",
            "job_description": "", "loaded": False
        }
        self.history.clear()
        print("Session cleared")

    def _detect_question_type(self, question):
        q = question.lower().strip()

        code_concepts = [
            'debounc', 'throttl', 'closur', 'memoiz', 'curry',
            'promise', 'async/await', 'async await', 'callback',
            'react hook', 'usestate', 'useeffect', 'usememo', 'usecallback',
            'higher order function', 'higher-order function',
            'currying', 'destructur', 'spread operator', 'rest operator',
            'arrow function', 'iife', 'generator function',
            'event loop', 'event bubbling', 'event delegation',
            'prototype', 'inheritance', 'this keyword',
            'exponential backoff', 'circuit breaker',
            'observer pattern', 'singleton',
            'polyfill', 'promise.all', 'promise.race',
            'usereducer', 'useref', 'usecontext',

            # 🆕 More JS concepts
            'hoisting', 'scope', 'variable scope', 'block scope', 'function scope',
            'let', 'const', 'var', 'temporal dead zone',
            'call', 'apply', 'bind', 'this binding',
            'immediately invoked', 'immediately-invoked',
            'promise chain', 'promise chaining', 'promise all',
            'try catch', 'try/catch', 'error handling',
            'json', 'json.parse', 'json.stringify',
            'array method', 'array methods', 'map filter reduce',
            'map', 'filter', 'reduce', 'foreach',
            'object method', 'object.keys', 'object.values', 'object.entries',
            'shallow copy', 'deep copy', 'clone',
            'equality', 'strict equality', 'loose equality', '=== vs ==',

            # 🆕 React-specific
            'props', 'react props', 'component', 'react component',
            'jsx', 'virtual dom', 'reconciliation',
            'component lifecycle', 'lifecycle method',
            'component did mount', 'componentdidmount',
            'component did update', 'componentdidupdate',
            'component will unmount', 'componentwillunmount',
            'controlled component', 'uncontrolled component',
            'controlled input', 'uncontrolled input',
            'hoc', 'higher order component', 'higher-order component',
            'render props', 'render prop',
            'context api', 'react context', 'context provider',
            'redux', 'redux toolkit', 'zustand', 'mobx',
            'react memo', 'react.memo', 'memoization',
            'lazy loading', 'react lazy', 'react.lazy',
            'suspense', 'react suspense',
            'error boundary', 'error boundaries',
            'portal', 'react portal',
            'fragment', 'react fragment',
            'key prop', 'react key',
            'state management', 'lifting state',
            'reconciliation', 'diffing algorithm',

            # 🆕 TypeScript
            'typescript', 'type annotation', 'type alias',
            'interface', 'generic', 'generics',
            'union type', 'intersection type',
            'utility types', 'partial', 'required', 'pick', 'omit',

            # 🆕 CSS/Styling
            'flexbox', 'grid', 'css grid',
            'responsive design', 'media query',
            'styled component', 'styled components',
            'tailwind', 'css-in-js',

            # 🆕 Design Patterns
            'design pattern', 'design patterns',
            'factory pattern', 'factory function',
            'strategy pattern', 'adapter pattern',
            'decorator pattern', 'proxy pattern',
            'pub sub', 'pub/sub', 'publisher subscriber',

            # 🆕 Data Structures & Algorithms
            'linked list', 'binary tree', 'hash map', 'hash table',
            'stack', 'queue', 'heap',
            'sorting', 'quicksort', 'mergesort',
            'searching', 'binary search',
            'recursion', 'recursive',
            'dynamic programming', 'memoization',

            # 🆕 API/Networking
            'rest api', 'rest', 'graphql', 'grpc',
            'http', 'https', 'websocket',
            'fetch', 'axios', 'ajax',
            'cors', 'cross origin',
            'authentication', 'jwt', 'oauth', 'token',
            'session', 'cookie', 'localstorage',

            # 🆕 Testing
            'unit test', 'integration test', 'e2e test',
            'jest', 'mocha', 'chai',
            'react testing library', 'cypress', 'playwright',
            'mock', 'stub', 'spy',

            # 🆕 Common concepts
            'immutability', 'mutability', 'pure function', 'side effect',
            'functional programming', 'oop', 'object oriented',
            'inheritance', 'composition', 'polymorphism', 'encapsulation',
            'dependency injection', 'ioc',
            'async programming', 'concurrency', 'parallelism',
            'promise', 'observable', 'stream',
            'garbage collection', 'memory management',
            'performance optimization', 'lazy loading', 'code splitting'
        ]
        definition_triggers = ['what is', 'what are', 'explain', 'define',
                               'how does', 'what does', 'tell me about', 'describe']
        if any(t in q for t in definition_triggers) and any(p in q for p in code_concepts):
            return ('code_concept', 550)

        comparison_patterns = [
            'difference between', 'differences between', 'compare',
            ' vs ', 'versus', 'pros and cons', 'when to use',
            'when should i use', 'which is better',
            'types of', 'various types'
        ]
        if any(p in q for p in comparison_patterns):
            return ('comparison', 400)

        hr_patterns = [
            'tell me about yourself', 'about yourself', 'introduce yourself',
            'why hire', 'why should we', 'weakness', 'strength',
            'why leaving', 'salary', 'notice period',
            'where do you see', 'career goal', 'nice to meet',
            'why do you want'
        ]
        if any(p in q for p in hr_patterns):
            return ('hr', 150)

        coding_patterns = [
            'write code', 'write a function', 'write a', 'implement',
            'code for', 'algorithm for', 'fix this code'
        ]
        if any(p in q for p in coding_patterns):
            return ('coding', 550)

        design_patterns = [
            'design a', 'design an', 'how would you build',
            'how would you design', 'architect', 'system design',
            'url shortener', 'chat application', 'rate limiter'
        ]
        if any(p in q for p in design_patterns):
            return ('system_design', 400)

        how_does_patterns = [
            'how does', 'how do', 'how is', 'how are',
            'walk me through how', 'explain how'
        ]
        if any(p in q for p in how_does_patterns):
            return ('how_does', 350)

        behavioral_patterns = [
            'tell me about a time', 'describe a time', 'describe a situation',
            'give an example', 'how did you handle', 'have you ever',
            'challenging', 'difficult', 'proud of', 'faced'
        ]
        if any(p in q for p in behavioral_patterns):
            return ('behavioral', 300)

        recap_patterns = [
            'list all', 'tell me about all', 'walk me through your',
            'summary of your', 'previous companies', 'work history',
            'in which company'
        ]
        if any(p in q for p in recap_patterns):
            return ('recap', 400)

        return ('concept', 280)

    def _clean_response(self, text):
        if not text:
            return text

        cleaned = text.strip()
        original_length = len(cleaned)

        patterns_to_strip = [
            r'^hi\s+there[!,.\s]*',
            r'^hello\s+there[!,.\s]*',
            r'^hey\s+there[!,.\s]*',
            r'^hi\s+[A-Z]\w+[!,.\s]*',
            r'^hey\s+[A-Z]\w+[!,.\s]*',
            r'^hello\s+[A-Z]\w+[!,.\s]*',
            r'^hi[!,.\s]+',
            r'^hey[!,.\s]+',
            r'^hello[!,.\s]+',
            r'^thanks?\s+for\s+having\s+me[^.!?]*[.!?,]\s*',
            r'^thanks?\s+for\s+the\s+question[^.!?]*[.!?,]\s*',
            r'^thanks?\s+for[^.!?]*[.!?,]\s*',
            r'^thank\s+you[^.!?]*[.!?,]\s*',
            r'^sure[!,.\s]+',
            r'^well[!,.\s]+',
            r'^great\s+question[!,.\s]*',
            r'^absolutely[!,.\s]*',
            r'^certainly[!,.\s]*',
            r'^of\s+course[!,.\s]*',
            r"^i'?d\s+be\s+happy\s+to[^.!?]*[.!?,]\s*",
            r'^let\s+me\s+tell\s+you[^.!?]*[.!?,]\s*',
            r'^first\s+of\s+all[!,.\s]*',
            r'^to\s+answer\s+your\s+question[!,.\s]*',
            r'^to\s+start[!,.\s]*',
            r"^i'?m\s+sorry[^.!?]*[.!?,]\s*",
            r'^i\s+apologize[^.!?]*[.!?,]\s*',
            r'^my\s+apologies[^.!?]*[.!?,]\s*',
            r"^i'?m\s+[A-Z]\w+(\s+\w+)?,?\s+a?\s*(senior|junior|lead|principal)?\s*(software|frontend|backend|full[- ]?stack)?\s*(engineer|developer|designer)[^.!?]*[.!?]\s*",
            r"^my\s+name\s+is\s+[A-Z]\w+[^.!?]*[.!?]\s*",
            r"^i\s+am\s+[A-Z]\w+(\s+\w+)?,?\s+a?\s*(senior|junior|lead|principal)?[^.!?]*[.!?]\s*",
            r"^this\s+is\s+[A-Z]\w+[^.!?]*[.!?]\s*",
        ]

        for pattern in patterns_to_strip:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE).strip()

        if cleaned and len(cleaned) < original_length:
            cleaned = cleaned[0].upper() + cleaned[1:]
            print(f"Stripped {original_length - len(cleaned)} chars of filler")

        return cleaned

    # ─────────────────────────────────
    # 🎯 MAIN GENERATE METHOD (with hybrid routing)
    # ─────────────────────────────────
    def generate(self, question, on_start, on_token, on_done, on_error):
        # LOCK: Reject if already generating
        if self.is_generating:
            print(f"Already generating — ignoring: {question[:50]}...")
            on_error("Already generating answer. Wait for current one to finish.")
            return

        self.is_generating = True

        try:
            print(f"\nQuestion: {question}")

            q_type, max_tokens_for_q = self._detect_question_type(question)
            print(f"Question type: {q_type} (max_tokens: {max_tokens_for_q})")

            # 🎯 SMART ROUTER: pick engine
            engine = self._pick_engine(q_type)
            engine_name = "Groq Llama 70B (Cloud)" if engine == "cloud" else "Local Mistral 7B"
            print(f"🎯 Engine: {engine.upper()} ({engine_name})")

            builder = PromptBuilder(self.session_context, self.history)
            prompt = builder.build(question, question_type=q_type)

            prompt_size = len(prompt)
            print(f"Prompt: {prompt_size} chars (~{prompt_size // 4} tokens)")

            on_start({
                "question": question,
                "mode": q_type,
                "engine": engine,
                "is_follow_up": len(self.history.history) > 0
            })

            # Route to selected engine with fallback
            try:
                if engine == "cloud":
                    full_answer, duration, first_token = self.groq.stream(
                        prompt, on_token, max_tokens=max_tokens_for_q
                    )
                else:
                    full_answer, duration, first_token = self.ollama.stream(
                        prompt, on_token, max_tokens=max_tokens_for_q
                    )
            except Exception as engine_error:
                # 🛡️ Fallback: if cloud fails, try local
                if engine == "cloud":
                    print(f"⚠️ Cloud failed ({engine_error}), falling back to LOCAL")
                    engine = "local"
                    full_answer, duration, first_token = self.ollama.stream(
                        prompt, on_token, max_tokens=max_tokens_for_q
                    )
                else:
                    raise

            cleaned_answer = self._clean_response(full_answer)

            if cleaned_answer.strip():
                self.history.add(question, cleaned_answer)

            word_count = len(cleaned_answer.split())
            speed = word_count / duration if duration > 0 else 0
            print(f"\n✅ Done in {duration:.2f}s | first_token={first_token:.2f}s | "
                  f"{word_count} words | {speed:.1f} w/s | type={q_type} | engine={engine}")

            on_done({
                "full_answer": cleaned_answer,
                "duration": duration,
                "mode": q_type,
                "engine": engine,
                "word_count": word_count,
                "is_follow_up": len(self.history.history) > 1
            })

        except Exception as e:
            print(f"LLM error: {e}")
            on_error(str(e))
        finally:
            self.is_generating = False
            print("🔓 Lock released")