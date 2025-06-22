// ---------------------------------------------------------------------------------
// API CLIENT FOR PYTHON BACKEND
// This file centralizes all communication with your FastAPI backend. Each
// function wraps a `fetch` call to a specific endpoint. This is a best
// practice because it keeps your components free of network logic and makes
// it easy to manage API calls from one place.
// ---------------------------------------------------------------------------------

import type {
    InteractiveResponse,
    PythonCompletionRequest,
    PythonCompletionSuggestion,
    // We will add our new type here
    LlmChatRequest,
} from './types'; // Assuming types are in a sibling file

// This function is unchanged.
export async function executeInteractivePython(
    serial: string,
    code: string,
    enableTracing: boolean = false
): Promise<InteractiveResponse> {
    const url = `/api/android/${serial}/interactive_python`;
    const body = { code, enable_tracing: enableTracing };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Interactive Python error: ${res.status} ${text}`);
    }
    return res.json();
}

// This function is unchanged.
export async function getPythonCompletions(
    payload: PythonCompletionRequest
): Promise<PythonCompletionSuggestion[]> {
    const url = '/api/python/completions';

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Completions error: ${res.status} ${text}`);
    }
    return res.json();
}

// ---------------------------------------------------------------------------------
// NEW: SEND CHAT MESSAGE FUNCTION
// This new function handles the entire process of sending a prompt to the LLM
// and processing the Server-Sent Events (SSE) stream in response. Your Svelte
// component will call this single function.
//
// @param payload - The complete request object matching the backend's model.
// @param onChunk - A callback function that will be executed for each piece
//                  of text received from the streaming response.
// ---------------------------------------------------------------------------------
export async function sendChatMessage(
    payload: LlmChatRequest,
    onChunk: (chunk: string) => void
): Promise<void> {
    const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            // We tell the server we can accept a text event stream
            'Accept': 'text/event-stream' 
        },
        body: JSON.stringify(payload)
    });

    // Error handling if the initial request fails
    if (!res.ok || !res.body) {
        const errorText = await res.text();
        throw new Error(`LLM API Error: ${res.status} ${errorText || 'Request failed'}`);
    }

    // Get the reader and decoder to process the stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Loop indefinitely to read from the stream
    while (true) {
        const { value, done } = await reader.read();
        // The `done` flag is true when the stream is closed.
        if (done) break;
        
        // Add the new data chunk to our buffer
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines (`\n\n`).
        // We process all complete messages in the buffer.
        let eolIndex;
        while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
            const messageBlock = buffer.slice(0, eolIndex).trim();
            // Remove the processed message from the buffer
            buffer = buffer.slice(eolIndex + 2);

            // Find the line that starts with "data:"
            const dataLine = messageBlock.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;

            try {
                // Extract the JSON content from the "data:" line
                const json = JSON.parse(dataLine.replace(/^data:\s*/, ''));
                // The actual text might be the string itself or inside a `content` property
                const chunk = typeof json === 'string' ? json : json.content || '';
                if (chunk) {
                    // If we got a valid chunk, call the callback function from the component
                    onChunk(chunk);
                }
            } catch (e) {
                console.warn("Failed to parse stream chunk JSON:", e);
            }
        }
    }
}

