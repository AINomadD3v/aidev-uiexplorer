// ─────────────────────────────────────────────────────────────────────────────
// LLM ASSISTANT STORE
// This store holds the state for the LLM Assistant chat. By keeping the
// conversation history in a central store, the state persists even if the
// LLMAssistant.svelte component is unmounted and remounted (e.g., when
// switching tabs).
// ─────────────────────────────────────────────────────────────────────────────

import { writable } from 'svelte/store';

// -----------------------------------------------------------------------------
// INTERFACE
// Defines the shape of a single chat message.
// -----------------------------------------------------------------------------
export interface ChatMessage {
    role: 'user' | 'assistant';
    raw: string; // The raw text or markdown content
}

// -----------------------------------------------------------------------------
// WRITABLE STORE
// We export a writable store initialized with a default "welcome" message.
// Any component can now import this `chatMessages` store to read, update, or
// subscribe to the conversation history.
// -----------------------------------------------------------------------------
export const chatMessages = writable<ChatMessage[]>([
    {
        role: 'assistant',
        raw: 'Hello! How can I assist you with your UI automation tasks today?'
    }
]);

