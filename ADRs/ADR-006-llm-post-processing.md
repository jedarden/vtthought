# ADR-006: LLM Post-Processing Pipeline

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

Raw STT output contains filler words, grammatical errors, and unclear phrasing. An LLM post-processing step transforms informal speech into clear, actionable text suitable for code commands.

## Decision Drivers

- **Quality**: Output should be polished and actionable
- **Latency**: Post-processing should add minimal delay (<500ms)
- **Cost**: Minimize LLM API costs
- **Consistency**: Predictable transformations
- **Customization**: User-specific preferences

## What Post-Processing Does

```
┌──────────────────────────────────────────────────────────────────────┐
│                    TRANSFORMATION EXAMPLES                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  INPUT (Raw STT):                                                     │
│  "um so I want to like create a new function that uh takes in a      │
│   user ID and then returns their uh profile data you know"           │
│                                                                       │
│  OUTPUT (Post-processed):                                             │
│  "Create a function that takes a user ID and returns profile data"   │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────── │
│                                                                       │
│  INPUT (Raw STT):                                                     │
│  "actually no wait let me think about this differently can you       │
│   delete the last function and instead make it async"                │
│                                                                       │
│  OUTPUT (Post-processed):                                             │
│  "Delete the last function and make it async instead"                │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────── │
│                                                                       │
│  INPUT (Raw STT):                                                     │
│  "fix that bug in the auth thing we were working on earlier"         │
│                                                                       │
│  OUTPUT (with context):                                               │
│  "Fix the JWT token expiration bug in src/auth/jwt_handler.py"       │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Options Considered

### Option A: Local LLM (Ollama) - Recommended for Self-Hosted

```
┌──────────────────────────────────────────────────────────────────────┐
│                    OLLAMA LOCAL LLM                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Models:                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  llama3.2:3b    (2GB)  - Fast, good for simple cleanup          │ │
│  │  llama3.1:8b    (5GB)  - Balanced speed/quality                 │ │
│  │  mistral:7b     (4GB)  - Good instruction following             │ │
│  │  phi-3:3.8b     (2GB)  - Efficient, code-aware                  │ │
│  │  qwen2.5:7b     (4GB)  - Strong multilingual                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Performance (llama3.1:8b, RTX 3090):                                │
│  - First token: ~100ms                                               │
│  - Tokens/sec: ~80-100                                               │
│  - Total latency (50 token output): ~500-600ms                       │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```python
import httpx

OLLAMA_URL = "http://localhost:11434/api/generate"

CLEANUP_PROMPT = """You are a speech-to-text cleanup assistant. Transform the following spoken transcription into clear, actionable text.

Rules:
1. Remove filler words (um, uh, like, you know, so, actually, basically)
2. Fix grammar and punctuation
3. Handle corrections ("actually no", "wait", "I mean") by using the corrected version
4. Keep technical terms accurate
5. Be concise - output only the cleaned text, no explanations
6. Preserve the user's intent exactly

Transcription: {text}

Cleaned text:"""

async def cleanup_with_ollama(raw_text: str, model: str = "llama3.1:8b") -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": model,
                "prompt": CLEANUP_PROMPT.format(text=raw_text),
                "stream": False,
                "options": {
                    "temperature": 0.1,  # Low temperature for consistency
                    "num_predict": 100,  # Limit output length
                }
            },
            timeout=10.0
        )
        return response.json()["response"].strip()
```

**Pros:**
- Complete privacy
- No per-request costs
- Customizable models
- Works offline

**Cons:**
- Requires GPU for good latency
- Model management overhead
- Quality varies by model

### Option B: Cloud LLM APIs (Claude/GPT-4o-mini)

```python
from anthropic import Anthropic

client = Anthropic()

async def cleanup_with_claude(raw_text: str) -> str:
    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=100,
        messages=[{
            "role": "user",
            "content": f"Clean up this speech transcription, removing filler words and fixing grammar. Output only the cleaned text:\n\n{raw_text}"
        }]
    )
    return response.content[0].text
```

**Cost comparison (per 1000 requests, ~50 tokens in, ~30 tokens out):**

| Model | Input Cost | Output Cost | Total |
|-------|------------|-------------|-------|
| Claude Haiku | $0.04 | $0.04 | ~$0.08 |
| GPT-4o-mini | $0.008 | $0.024 | ~$0.03 |
| Gemini Flash | $0.0075 | $0.03 | ~$0.04 |

**Pros:**
- Highest quality
- No infrastructure
- Always available

**Cons:**
- Per-request costs
- Latency (~200-500ms network)
- Privacy concerns

### Option C: Fine-tuned Small Model

Train a small model specifically for transcription cleanup.

**Pros:**
- Optimized for task
- Fast inference
- Consistent behavior

**Cons:**
- Training effort
- Data collection needed
- Maintenance burden

### Option D: Rule-Based + Small LLM Hybrid

```python
import re

# Rule-based preprocessing
FILLER_PATTERNS = [
    r'\b(um|uh|er|ah)\b',
    r'\b(like|you know|basically|actually|so)\b(?=\s)',
    r'\b(i mean|wait|no wait)\b',
]

def rule_based_cleanup(text: str) -> str:
    for pattern in FILLER_PATTERNS:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

async def hybrid_cleanup(raw_text: str) -> str:
    # First pass: rule-based
    cleaned = rule_based_cleanup(raw_text)

    # Second pass: LLM for complex cases
    if needs_llm_cleanup(cleaned):
        cleaned = await cleanup_with_ollama(cleaned)

    return cleaned

def needs_llm_cleanup(text: str) -> bool:
    # Use LLM for corrections, complex grammar
    correction_words = ['actually', 'instead', 'no wait', 'i mean']
    return any(word in text.lower() for word in correction_words)
```

**Pros:**
- Fast for simple cases
- LLM only when needed
- Lower cost

**Cons:**
- More complex logic
- May miss edge cases

## Decision

**Option A: Ollama with llama3.1:8b** for self-hosted deployments

Rationale:
1. Complete privacy (matches user's Docker deployment model)
2. No per-request costs
3. Good latency with GPU (~500ms)
4. Quality sufficient for cleanup task

**Option B: Claude Haiku** as fallback/alternative for users without GPU

## Prompt Engineering

The prompt must work across any LLM (Ollama, Claude, OpenAI, Gemini, local models) and provide sufficient context for accurate cleanup.

### Context Structure

```python
@dataclass
class CleanupContext:
    """Context passed to LLM for transcription cleanup."""

    # Required
    raw_transcription: str

    # User personalization
    user_vocabulary: list[str]        # Custom terms the user has added
    learned_corrections: dict[str, str]  # Past corrections: {"clod": "Claude"}

    # Session context (optional but improves accuracy)
    current_file: Optional[str]       # e.g., "src/auth/handler.py"
    recent_actions: list[str]         # Last 3-5 actions in session
    open_files: list[str]             # Currently open editor tabs
    git_branch: Optional[str]         # Current branch name

    # Preferences
    cleanup_level: str                # "minimal", "moderate", "aggressive"
    preserve_casing: bool             # Keep original casing for code terms
```

### Base Cleanup Prompt (LLM-Agnostic)

```python
def build_cleanup_prompt(ctx: CleanupContext) -> str:
    """Build a prompt that works with any LLM."""

    # Build vocabulary hint section
    vocab_section = ""
    if ctx.user_vocabulary:
        vocab_section = f"""
## Technical Vocabulary
These are known technical terms - preserve them exactly:
{', '.join(ctx.user_vocabulary[:30])}
"""

    # Build corrections section
    corrections_section = ""
    if ctx.learned_corrections:
        examples = [f'"{k}" → "{v}"' for k, v in list(ctx.learned_corrections.items())[:10]]
        corrections_section = f"""
## Known Corrections
Apply these learned corrections:
{chr(10).join(examples)}
"""

    # Build context section
    context_section = ""
    if ctx.current_file or ctx.recent_actions:
        context_section = "## Current Context\n"
        if ctx.current_file:
            context_section += f"- Working file: {ctx.current_file}\n"
        if ctx.git_branch:
            context_section += f"- Git branch: {ctx.git_branch}\n"
        if ctx.recent_actions:
            context_section += f"- Recent actions: {', '.join(ctx.recent_actions[-3:])}\n"
        if ctx.open_files:
            context_section += f"- Open files: {', '.join(ctx.open_files[:5])}\n"

    # Cleanup level instructions
    level_instructions = {
        "minimal": "Only remove filler words (um, uh, er). Keep everything else.",
        "moderate": "Remove filler words, fix grammar, handle corrections. Keep technical accuracy.",
        "aggressive": "Rewrite for clarity while preserving exact intent. Make it concise and professional."
    }

    return f"""You are a speech-to-text cleanup assistant for a developer tool. Transform the spoken transcription into clear, actionable text.

## Rules
1. REMOVE filler words: um, uh, like, you know, so, basically, actually, kind of, sort of, er, ah
2. HANDLE self-corrections: When the speaker says "actually", "wait", "no", "I mean", use ONLY the corrected version
   - "create a file wait no delete the file" → "delete the file"
   - "um add a function actually make it a class" → "add a class"
3. FIX grammar and add punctuation
4. PRESERVE technical terms, function names, file paths, and code exactly
5. OUTPUT only the cleaned text - no explanations, no quotes, no prefixes
{vocab_section}{corrections_section}{context_section}
## Cleanup Level: {ctx.cleanup_level}
{level_instructions.get(ctx.cleanup_level, level_instructions["moderate"])}

## Examples

Input: "um can you like create a new function called uh get user data"
Output: Create a new function called getUserData

Input: "fix that bug in the uh wait no actually delete the whole file"
Output: Delete the whole file

Input: "add a try catch block to the you know the main function"
Output: Add a try-catch block to the main function

Input: "open the um what's it called the config dot yaml file"
Output: Open the config.yaml file

Input: "run the tests no wait first commit the changes then run tests"
Output: Commit the changes, then run the tests

## Transcription to Clean
{ctx.raw_transcription}

## Cleaned Output"""
```

### LLM Provider Abstraction

```python
from abc import ABC, abstractmethod
from typing import AsyncIterator

class LLMProvider(ABC):
    """Abstract base for any LLM provider."""

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Get completion from LLM."""
        pass

    @abstractmethod
    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """Stream completion from LLM."""
        pass


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str = "llama3.1:8b"):
        self.base_url = base_url
        self.model = model

    async def complete(self, prompt: str) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": False},
                timeout=30.0
            )
            return response.json()["response"].strip()

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": True},
            ) as response:
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if "response" in data:
                            yield data["response"]


class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "claude-3-5-haiku-20241022"):
        self.client = Anthropic(api_key=api_key)
        self.model = model

    async def complete(self, prompt: str) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        with self.client.messages.stream(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            for text in stream.text_stream:
                yield text


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.client = OpenAI(api_key=api_key)
        self.model = model

    async def complete(self, prompt: str) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        stream = self.client.chat.completions.create(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )
        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
```

### Configuration

```python
# Environment-based LLM selection
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")  # ollama, anthropic, openai
LLM_MODEL = os.getenv("LLM_MODEL", "llama3.1:8b")
LLM_URL = os.getenv("LLM_URL", "http://localhost:11434")  # For Ollama
LLM_API_KEY = os.getenv("LLM_API_KEY", "")  # For cloud providers

def get_llm_provider() -> LLMProvider:
    if LLM_PROVIDER == "ollama":
        return OllamaProvider(LLM_URL, LLM_MODEL)
    elif LLM_PROVIDER == "anthropic":
        return AnthropicProvider(LLM_API_KEY, LLM_MODEL)
    elif LLM_PROVIDER == "openai":
        return OpenAIProvider(LLM_API_KEY, LLM_MODEL)
    else:
        raise ValueError(f"Unknown LLM provider: {LLM_PROVIDER}")
```

### Full Cleanup Pipeline

```python
class TranscriptionCleaner:
    def __init__(self, llm: LLMProvider, db: Database, cache: VocabularyCache):
        self.llm = llm
        self.db = db
        self.cache = cache

    async def cleanup(
        self,
        raw_text: str,
        user_id: str,
        session_context: Optional[SessionContext] = None
    ) -> str:
        # Skip LLM for very short text
        if len(raw_text.split()) <= 3:
            return self._rule_based_cleanup(raw_text)

        # Build context
        user_vocab = await self._get_user_vocabulary(user_id)
        corrections = await self._get_user_corrections(user_id)
        prefs = await self._get_user_preferences(user_id)

        ctx = CleanupContext(
            raw_transcription=raw_text,
            user_vocabulary=user_vocab,
            learned_corrections=corrections,
            current_file=session_context.current_file if session_context else None,
            recent_actions=session_context.recent_actions if session_context else [],
            open_files=session_context.open_files if session_context else [],
            git_branch=session_context.git_branch if session_context else None,
            cleanup_level=prefs.cleanup_level,
            preserve_casing=True
        )

        # Build prompt and get completion
        prompt = build_cleanup_prompt(ctx)
        cleaned = await self.llm.complete(prompt)

        # Apply any remaining learned corrections
        cleaned = self._apply_corrections(cleaned, corrections)

        return cleaned

    def _rule_based_cleanup(self, text: str) -> str:
        """Fast cleanup for short text without LLM."""
        import re
        # Remove common fillers
        fillers = r'\b(um|uh|er|ah|like|you know|basically|actually|so)\b'
        text = re.sub(fillers, '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s+', ' ', text).strip()
        return text.capitalize() if text else text

    def _apply_corrections(self, text: str, corrections: dict[str, str]) -> str:
        """Apply user's learned corrections."""
        for wrong, right in corrections.items():
            text = re.sub(re.escape(wrong), right, text, flags=re.IGNORECASE)
        return text
```

## Implementation Details

### Pipeline Integration

```python
class TranscriptionPipeline:
    def __init__(self, stt: WhisperSTT, llm_url: str):
        self.stt = stt
        self.llm_url = llm_url

    async def process(self, audio: np.ndarray, enhance: bool = True) -> TranscriptResult:
        # Step 1: STT
        raw_text = self.stt.transcribe(audio)

        if not enhance:
            return TranscriptResult(raw=raw_text, enhanced=raw_text)

        # Step 2: LLM cleanup
        enhanced_text = await self.cleanup(raw_text)

        # Step 3: Voice command parsing
        commands = self.parse_commands(enhanced_text)

        return TranscriptResult(
            raw=raw_text,
            enhanced=enhanced_text,
            commands=commands
        )

    async def cleanup(self, text: str) -> str:
        # Skip LLM for very short/simple text
        if len(text.split()) <= 3:
            return rule_based_cleanup(text)

        return await cleanup_with_ollama(text)
```

### Quality Validation

```python
def validate_cleanup(raw: str, cleaned: str) -> bool:
    """Ensure cleanup didn't lose important content."""

    # Extract key nouns/verbs from raw
    raw_keywords = extract_keywords(raw)
    cleaned_keywords = extract_keywords(cleaned)

    # Key terms should be preserved
    preserved = len(raw_keywords & cleaned_keywords) / len(raw_keywords)

    return preserved > 0.7  # At least 70% of keywords preserved
```

## End-to-End Streaming Architecture

The entire pipeline streams to minimize latency between speaking and seeing text:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    END-TO-END STREAMING PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User speaks ──▶ Audio chunks (~100ms)                                      │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  WHISPER (Streaming Mode)                                            │    │
│  │  - Partial results every ~500ms                                      │    │
│  │  - Final high-quality result on silence                              │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│       ┌─────────────────────────┴─────────────────────────┐                 │
│       ▼                                                   ▼                 │
│  Partial transcript                              Final transcript           │
│  (shown in gray/italic)                                  │                  │
│       │                                                   │                  │
│       │                                                   ▼                  │
│       │                          ┌─────────────────────────────────────┐    │
│       │                          │  LLM (Streaming)                    │    │
│       │                          │  - Stream tokens as generated       │    │
│       │                          │  - ~50-100 tokens/sec               │    │
│       │                          └──────────────────────┬──────────────┘    │
│       │                                                 │                    │
│       ▼                                                 ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  VS CODE EXTENSION                                                   │    │
│  │  - Replace partial with cleaned text as tokens arrive               │    │
│  │  - Character-by-character insertion for natural feel                │    │
│  │  - Terminal: stream directly without partial display                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  LATENCY TARGETS:                                                            │
│  ├─ Time to first partial: ~300ms                                           │
│  ├─ Time to final transcript: ~500ms after speech ends                      │
│  ├─ Time to first cleaned token: ~200ms after final transcript              │
│  └─ Total perceived latency: User sees text appearing as they speak         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WebSocket Streaming Protocol

```typescript
// Server → Client messages
type ServerMessage =
    | { type: 'partial'; text: string; confidence: number }
    | { type: 'streaming'; token: string; position: number }
    | { type: 'final'; raw: string; cleaned: string; commands: VoiceCommand[] }
    | { type: 'error'; code: string; message: string };
```

### Server-Side Streaming

```python
async def process_audio_streaming(
    websocket: WebSocket,
    user_id: str,
    session_ctx: SessionContext
) -> None:
    """Full streaming pipeline: Audio → Partial STT → Final STT → Streaming LLM → Client."""

    whisper = WhisperStreaming()
    cleaner = TranscriptionCleaner(get_llm_provider(), db, cache)

    audio_buffer = bytearray()
    last_partial = ""

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if "bytes" in message:
                audio_chunk = message["bytes"]
                audio_buffer.extend(audio_chunk)

                # Send partial every ~500ms of audio (8000 samples at 16kHz)
                if len(audio_buffer) >= 8000:
                    partial = await whisper.transcribe_partial(bytes(audio_buffer))
                    if partial and partial != last_partial:
                        await websocket.send_json({
                            "type": "partial",
                            "text": partial,
                            "confidence": 0.7
                        })
                        last_partial = partial

            elif "text" in message:
                data = json.loads(message["text"])

                if data.get("type") == "stop":
                    # User stopped speaking - finalize
                    if audio_buffer:
                        # High-quality final transcription
                        final_text = await whisper.transcribe_final(bytes(audio_buffer))

                        await websocket.send_json({
                            "type": "partial",
                            "text": final_text,
                            "confidence": 0.95
                        })

                        # Stream LLM cleanup
                        ctx = await cleaner.build_context(final_text, user_id, session_ctx)
                        prompt = build_cleanup_prompt(ctx)

                        position = 0
                        cleaned_tokens = []

                        async for token in cleaner.llm.stream(prompt):
                            cleaned_tokens.append(token)
                            await websocket.send_json({
                                "type": "streaming",
                                "token": token,
                                "position": position
                            })
                            position += len(token)

                        cleaned_text = "".join(cleaned_tokens).strip()
                        commands = parse_voice_commands(cleaned_text)

                        await websocket.send_json({
                            "type": "final",
                            "raw": final_text,
                            "cleaned": cleaned_text,
                            "commands": [cmd.dict() for cmd in commands]
                        })

                        audio_buffer.clear()
                        last_partial = ""

    except WebSocketDisconnect:
        pass
```

### Client-Side Streaming Display

```typescript
class StreamingInserter {
    private partialRange: vscode.Range | null = null;
    private cleanedText = '';
    private insertStart: vscode.Position | null = null;

    async onMessage(msg: ServerMessage, target: 'editor' | 'terminal') {
        if (target === 'terminal') {
            return this.handleTerminal(msg);
        }
        return this.handleEditor(msg);
    }

    private async handleEditor(msg: ServerMessage) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        switch (msg.type) {
            case 'partial':
                // Show/update partial in gray italic
                await this.showPartial(editor, msg.text);
                break;

            case 'streaming':
                // First token: clear partial, start inserting cleaned
                if (this.partialRange) {
                    await this.clearPartial(editor);
                }
                await this.appendToken(editor, msg.token);
                break;

            case 'final':
                // Verify final text, execute commands
                await this.finalize(editor, msg.cleaned);
                for (const cmd of msg.commands) {
                    await executeVoiceCommand(cmd);
                }
                break;
        }
    }

    private async handleTerminal(msg: ServerMessage) {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) return;

        switch (msg.type) {
            case 'partial':
                // Don't show partials in terminal - too disruptive
                break;

            case 'streaming':
                // Stream each token directly
                terminal.sendText(msg.token, false);
                break;

            case 'final':
                // Execute voice commands (like "enter")
                for (const cmd of msg.commands) {
                    await executeVoiceCommand(cmd);
                }
                break;
        }
    }

    private async showPartial(editor: vscode.TextEditor, text: string) {
        if (!this.insertStart) {
            this.insertStart = editor.selection.active;
        }

        const currentEnd = this.insertStart.translate(0, this.cleanedText.length);

        await editor.edit(eb => {
            if (this.partialRange) {
                eb.replace(this.partialRange, text);
            } else {
                eb.insert(currentEnd, text);
            }
        });

        this.partialRange = new vscode.Range(
            currentEnd,
            currentEnd.translate(0, text.length)
        );

        // Apply gray italic decoration
        this.applyPartialStyle(editor);
    }

    private async appendToken(editor: vscode.TextEditor, token: string) {
        const position = this.insertStart!.translate(0, this.cleanedText.length);
        await editor.edit(eb => eb.insert(position, token));
        this.cleanedText += token;
    }
}
```

## Interim Results with Text Rewriting

A critical UX improvement: displayed text should be **actively rewritten/corrected** as the system gains more confidence, not just appended to.

### How Interim Results Work

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTERIM RESULTS WITH REWRITING                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User says: "I need analytics for the customer dashboard"                   │
│                                                                              │
│  Time    What user sees (in gray, not yet committed)                        │
│  ────    ──────────────────────────────────────────────                     │
│  0.3s    "I need"                                                           │
│  0.5s    "I need an"                                                        │
│  0.7s    "I need an analyst"        ← partial, low confidence              │
│  0.9s    "I need analytics"         ← CORRECTED when "ics" heard           │
│  1.1s    "I need analytics for"                                             │
│  1.3s    "I need analytics for the custom"                                  │
│  1.5s    "I need analytics for the customer"  ← CORRECTED on "mer"         │
│  1.8s    "I need analytics for the customer dashboard"                      │
│  2.0s    [silence detected - finalize and send to LLM]                      │
│                                                                              │
│  After LLM cleanup (replaces gray text with final):                         │
│  "Add analytics to the customer dashboard"                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Protocol Extension for Rewriting

```typescript
// Extended server → client messages
type ServerMessage =
    | {
        type: 'interim';
        text: string;           // Full current transcription
        is_final: boolean;      // false = may change, true = won't change
        confidence: number;     // 0.0-1.0
        changes: TextChange[];  // What changed from previous interim
      }
    | { type: 'streaming'; token: string; position: number }
    | { type: 'final'; raw: string; cleaned: string; commands: VoiceCommand[] }
    | { type: 'error'; code: string; message: string };

interface TextChange {
    start: number;      // Character position
    deleteCount: number;  // Characters to remove
    insert: string;       // Text to insert
}
```

### Server-Side Chunked Processing with Rewriting

```python
class WhisperStreamingWithInterim:
    """Whisper streaming with interim result correction."""

    def __init__(self, model: str = "base"):
        self.whisper = faster_whisper.WhisperModel(model, device="cuda")
        self.audio_buffer = bytearray()
        self.last_transcript = ""
        self.chunk_size = 16000  # 1 second at 16kHz
        self.overlap = 4000     # 250ms overlap for context

    async def process_chunk(self, audio_chunk: bytes) -> AsyncIterator[InterimResult]:
        """Process audio chunk and yield interim results with corrections."""
        self.audio_buffer.extend(audio_chunk)

        # Process every ~500ms of audio
        if len(self.audio_buffer) < self.chunk_size // 2:
            return

        # Transcribe with overlapping window for better accuracy
        audio_np = np.frombuffer(bytes(self.audio_buffer), dtype=np.int16)
        audio_float = audio_np.astype(np.float32) / 32768.0

        segments, info = self.whisper.transcribe(
            audio_float,
            language="en",
            condition_on_previous_text=True,
            vad_filter=True,
        )

        current_transcript = " ".join(seg.text for seg in segments).strip()

        if current_transcript != self.last_transcript:
            # Calculate changes for efficient client-side update
            changes = self._compute_diff(self.last_transcript, current_transcript)

            yield InterimResult(
                text=current_transcript,
                is_final=False,
                confidence=self._estimate_confidence(info),
                changes=changes
            )

            self.last_transcript = current_transcript

    async def finalize(self) -> InterimResult:
        """Finalize transcription when user stops speaking."""
        if not self.audio_buffer:
            return None

        # Full high-quality transcription on complete audio
        audio_np = np.frombuffer(bytes(self.audio_buffer), dtype=np.int16)
        audio_float = audio_np.astype(np.float32) / 32768.0

        segments, info = self.whisper.transcribe(
            audio_float,
            language="en",
            beam_size=5,  # Higher quality for final
            best_of=5,
            temperature=0.0,
        )

        final_transcript = " ".join(seg.text for seg in segments).strip()

        return InterimResult(
            text=final_transcript,
            is_final=True,
            confidence=0.95,
            changes=self._compute_diff(self.last_transcript, final_transcript)
        )

    def _compute_diff(self, old: str, new: str) -> list[TextChange]:
        """Compute minimal edit operations to transform old → new."""
        import difflib

        matcher = difflib.SequenceMatcher(None, old, new)
        changes = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == 'replace':
                changes.append(TextChange(
                    start=i1,
                    deleteCount=i2 - i1,
                    insert=new[j1:j2]
                ))
            elif op == 'insert':
                changes.append(TextChange(
                    start=i1,
                    deleteCount=0,
                    insert=new[j1:j2]
                ))
            elif op == 'delete':
                changes.append(TextChange(
                    start=i1,
                    deleteCount=i2 - i1,
                    insert=""
                ))

        return changes

    def _estimate_confidence(self, info) -> float:
        """Estimate transcription confidence."""
        # Use VAD probability and language probability
        return min(info.language_probability, 0.95)
```

### Client-Side Rewriting Display

See **ADR-007: Text Insertion** for the complete `InterimTextManager` implementation. Summary of the key mechanics:

```typescript
/**
 * InterimTextManager handles the core challenge of text replacement:
 * - Tracks a fixed "anchor" position where dictation started
 * - Tracks current interim text length to calculate replacement range
 * - Uses atomic editBuilder.replace() for flicker-free updates
 * - Groups all edits into single undo operation
 * - Applies gray/italic decoration to indicate "may change"
 */
class InterimTextManager {
    private anchor: vscode.Position | null = null;
    private interimLength = 0;
    private interimStyle: vscode.TextEditorDecorationType;

    async handleInterim(editor: vscode.TextEditor, text: string, isFinal: boolean) {
        // First interim: record anchor position
        if (!this.anchor) {
            this.anchor = editor.selection.active;
        }

        // Calculate range of existing interim text
        const interimRange = new vscode.Range(
            this.anchor,
            this.anchor.translate(0, this.interimLength)
        );

        // Atomic edit: replace entire interim region with new text
        await editor.edit(editBuilder => {
            if (this.interimLength > 0) {
                editBuilder.replace(interimRange, text);
            } else {
                editBuilder.insert(this.anchor!, text);
            }
        }, {
            undoStopBefore: false,  // Group with previous edits
            undoStopAfter: false,   // Don't break undo chain
        });

        this.interimLength = text.length;

        // Apply/remove gray italic styling
        if (!isFinal) {
            const newRange = new vscode.Range(
                this.anchor,
                this.anchor.translate(0, this.interimLength)
            );
            editor.setDecorations(this.interimStyle, [newRange]);
        } else {
            editor.setDecorations(this.interimStyle, []);
        }
    }

    async handleCleanedText(editor: vscode.TextEditor, cleanedText: string) {
        // Replace interim with final cleaned text
        const interimRange = new vscode.Range(
            this.anchor!,
            this.anchor!.translate(0, this.interimLength)
        );

        await editor.edit(editBuilder => {
            editBuilder.replace(interimRange, cleanedText);
        }, {
            undoStopBefore: false,
            undoStopAfter: true,  // End undo group
        });

        editor.setDecorations(this.interimStyle, []);
        this.reset();
    }
}
```

### Benefits of Interim Rewriting

| Feature | Without Rewriting | With Rewriting |
|---------|------------------|----------------|
| User sees "analyst" then "analytics" | Appends "ics" → "analystcs" (broken) | Corrects → "analytics" |
| Confidence feedback | None | Gray styling = may change |
| Mid-word corrections | Impossible | Natural (as speech continues) |
| Word boundary detection | Immediate (often wrong) | Delayed until confident |

### Integration with LLM Cleanup

```python
async def process_with_interim_and_cleanup(
    websocket: WebSocket,
    user_id: str,
    session_ctx: SessionContext
) -> None:
    """Full pipeline: Audio → Interim STT (rewriting) → Final STT → Streaming LLM."""

    whisper = WhisperStreamingWithInterim()
    cleaner = TranscriptionCleaner(get_llm_provider(), db, cache)

    try:
        async for message in websocket.iter_bytes():
            # Send interim results with potential corrections
            async for interim in whisper.process_chunk(message):
                await websocket.send_json({
                    "type": "interim",
                    "text": interim.text,
                    "is_final": interim.is_final,
                    "confidence": interim.confidence,
                    "changes": [c.dict() for c in interim.changes]
                })

        # User stopped - finalize and cleanup
        final = await whisper.finalize()
        if final:
            await websocket.send_json({
                "type": "interim",
                "text": final.text,
                "is_final": True,
                "confidence": final.confidence,
                "changes": [c.dict() for c in final.changes]
            })

            # Stream LLM cleanup
            ctx = await cleaner.build_context(final.text, user_id, session_ctx)
            prompt = build_cleanup_prompt(ctx)

            position = 0
            async for token in cleaner.llm.stream(prompt):
                await websocket.send_json({
                    "type": "streaming",
                    "token": token,
                    "position": position
                })
                position += len(token)

            # Send final result
            cleaned_text = await cleaner.get_full_response()
            commands = parse_voice_commands(cleaned_text)

            await websocket.send_json({
                "type": "final",
                "raw": final.text,
                "cleaned": cleaned_text,
                "commands": [cmd.dict() for cmd in commands]
            })

    except WebSocketDisconnect:
        pass
```

## Consequences

### Positive
- **Low perceived latency** - streaming shows text as user speaks
- **Natural corrections** - text rewrites as more context arrives (like Deepgram)
- Polished, natural-sounding output
- Handles natural speech patterns
- Context-aware resolution with user vocabulary
- Privacy preserved with local LLM option
- Works with any LLM provider (Ollama, Claude, OpenAI, etc.)

### Negative
- Requires LLM with streaming support
- Network latency if using cloud LLM
- LLM can occasionally alter meaning

### Mitigations
- **Streaming throughout** minimizes perceived latency
- Partial transcripts show immediately while LLM processes
- User can disable LLM cleanup for raw transcription
- Learned corrections catch common LLM mistakes
- Validation ensures keywords preserved

## Related ADRs
- ADR-005: STT Engine Selection
- ADR-007: Text Insertion (detailed `InterimTextManager` implementation)
- ADR-008: Voice Commands
- ADR-009: Docker Container Architecture
