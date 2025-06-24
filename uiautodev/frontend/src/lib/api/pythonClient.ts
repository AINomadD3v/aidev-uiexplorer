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
	LlmChatRequest
} from './types'; // Assuming types are in a sibling file

const BASE_URL = ''; // Assuming relative URLs to the same host

export async function executeInteractivePython(
	serial: string,
	code: string,
	enableTracing: boolean = false
): Promise<InteractiveResponse> {
	const url = `${BASE_URL}/api/android/${serial}/interactive_python`;
	const body = { code, enable_tracing: enableTracing };

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Interactive Python error: ${res.status} ${text}`);
	}
	return res.json();
}

/**
 * ✅ UPDATED: This function sends a request to interrupt the running Python script.
 * It now accepts the device serial number and sends it in the request body,
 * matching the updated backend endpoint.
 * @param serial The serial number of the device running the script to interrupt.
 */
export async function interruptExecution(serial: string): Promise<void> {
	const url = `${BASE_URL}/api/python/interrupt`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ serial: serial }) // Send serial in the body
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Interrupt error: ${res.status} ${text}`);
	}
}

export async function getPythonCompletions(
	payload: PythonCompletionRequest
): Promise<PythonCompletionSuggestion[]> {
	const url = `${BASE_URL}/api/python/completions`;

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Completions error: ${res.status} ${text}`);
	}
	return res.json();
}

export async function sendChatMessage(
	payload: LlmChatRequest,
	onChunk: (chunk: string) => void
): Promise<void> {
	const res = await fetch(`${BASE_URL}/api/llm/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'text/event-stream'
		},
		body: JSON.stringify(payload)
	});

	if (!res.ok || !res.body) {
		const errorText = await res.text();
		throw new Error(`LLM API Error: ${res.status} ${errorText || 'Request failed'}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		let eolIndex;
		while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
			const messageBlock = buffer.slice(0, eolIndex).trim();
			buffer = buffer.slice(eolIndex + 2);

			const dataLine = messageBlock.split('\n').find((l) => l.startsWith('data:'));
			if (!dataLine) continue;

			try {
				const json = JSON.parse(dataLine.replace(/^data:\s*/, ''));
				const chunk = typeof json === 'string' ? json : json.content || '';
				if (chunk) {
					onChunk(chunk);
				}
			} catch (e) {
				console.warn('Failed to parse stream chunk JSON:', e);
			}
		}
	}
}

