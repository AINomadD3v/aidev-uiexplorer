// src/lib/api/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript interfaces for our Python console and completions APIs.
// ─────────────────────────────────────────────────────────────────────────────

// Response shape from /api/android/{serial}/interactive_python
export interface InteractiveResponse {
  stdout: string;                 // All text printed to stdout
  stderr: string;                 // All text printed to stderr
  result: any | null;             // Return value of the last expression, if any
  execution_error?: string;       // Full traceback if exception occurred
  debug_log?: string;             // Optional trace log (if you enable tracing)
}

// Request payload for completions
export interface PythonCompletionRequest {
  code: string;
  line: number;       // zero-based line index
  column: number;     // zero-based column index
  filename?: string;  // defaults to "inspector_code.py"
}

// One suggestion from /api/python/completions
export interface PythonCompletionSuggestion {
  text: string;        // Text to insert
  displayText: string; // Text shown in the dropdown
  type?: string;       // e.g. "function", "module", etc.
}
// ---------------------------------------------------------------------------------
// NEW: LLM CHAT REQUEST TYPE
// Add this interface. It defines the exact shape of the JSON object that our
// new `sendChatMessage` function sends to the backend. This helps prevent bugs
// by ensuring the frontend and backend are always in sync.
// ---------------------------------------------------------------------------------
export interface LlmChatRequest {
    prompt: string;
    context: Record<string, any>; // A flexible object for all our context data
    history: { role: 'user' | 'assistant'; content: string }[];
    provider: 'deepseek' | 'openai';
}

