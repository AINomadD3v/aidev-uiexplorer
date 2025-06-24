/**
 * @file This store holds the state for the LLM Assistant chat.
 * By keeping the conversation history in a central store, the state persists
 * even if the LLMAssistant.svelte component is unmounted and remounted.
 */

import { writable } from 'svelte/store';

// ─── DATA STRUCTURES ────────────────────────────────────────────────────────────────────────────

/**
 * ✅ A new, more robust payload for code edits. Instead of a fragile diff patch,
 * this structure specifies a line range to be replaced with a new block of code.
 * This aligns directly with CodeMirror's search-and-replace functionality.
 */
export interface ToolCodeEdit {
	tool_name: 'propose_edit';
	explanation: string;
	/** The type of edit. We now prioritize replacing a block of code. */
	edit_type: 'REPLACE_BLOCK' | 'REPLACE_ENTIRE_SCRIPT';
	/** The 1-based starting line number for the replacement. */
	start_line?: number;
	/** The 1-based ending line number for the replacement. */
	end_line?: number;
	/** The new code to insert between the start and end lines. */
	code?: string;
}

/** * Defines the shape of a single message in the chat history, updated for the
 * new state-locking and line-replacement architecture.
 */
export interface ChatMessage {
	role: 'user' | 'assistant';
	type: 'message' | 'tool_code_edit'; // The type of content this message holds
	content: string; // The raw text for a message, or the explanation for a tool call
	toolPayload?: ToolCodeEdit; // The structured data, only present if it's a tool call
	
    /**
     * This property holds an exact snapshot of the editor's code at the moment
     * the user sent the prompt. This prevents state synchronization errors.
     */
	codeSnapshot?: string; 
}

// ─── WRITABLE STORE ─────────────────────────────────────────────────────────────────────────────

/**
 * The store itself. It is a writable array of ChatMessage objects.
 * We export it so any component can import it to read, update, or subscribe to
 * the conversation history.
 */
export const chatMessages = writable<ChatMessage[]>([
	// The initial "welcome" message that appears when the application loads.
	{
		role: 'assistant',
		type: 'message',
		content: 'Hello! How can I assist you with your UI automation tasks today?',
		toolPayload: undefined,
        codeSnapshot: undefined // The initial message does not have a code snapshot.
	}
]);

