/**
 * @file This store holds the state for the LLM Assistant chat.
 * By keeping the conversation history in a central store, the state persists
 * even if the LLMAssistant.svelte component is unmounted and remounted.
 */

import { writable } from 'svelte/store';

// ─── DATA STRUCTURES ────────────────────────────────────────────────────────────────────────────

/** A structured payload for when the LLM suggests a code edit via a tool call. */
export interface ToolCodeEdit {
	tool_name: 'propose_edit';
	explanation: string;
	edit_type: 'APPLY_DIFF_PATCH' | 'REPLACE_ENTIRE_SCRIPT';
	patch?: string; // Present for diff patches
	code?: string; // Present for full replacements
}

/** Defines the shape of a single message in the chat history. */
export interface ChatMessage {
	role: 'user' | 'assistant';
	type: 'message' | 'tool_code_edit'; // The type of content this message holds
	content: string; // The raw text for a message, or the explanation for a tool call
	toolPayload?: ToolCodeEdit; // The structured data, only present if it's a tool call
}

// ─── WRITABLE STORE ─────────────────────────────────────────────────────────────────────────────

/**
 * The store itself. It is a writable array of ChatMessage objects.
 * We export it so any component can import it to read, update, or subscribe to
 * the conversation history.
 */
export const chatMessages = writable<ChatMessage[]>([
	// The initial "welcome" message must conform to our new ChatMessage interface.
	{
		role: 'assistant',
		type: 'message',
		content: 'Hello! How can I assist you with your UI automation tasks today?'
	}
]);
