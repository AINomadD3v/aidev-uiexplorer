<script lang="ts">
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { marked } from 'marked';
	import hljs from 'highlight.js/lib/core';
	import python from 'highlight.js/lib/languages/python';
	import diff from 'highlight.js/lib/languages/diff';
	import 'highlight.js/styles/github-dark.css';

	import { applyPatch } from 'diff';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';
	import type { ChatMessage as ChatMessageType } from '$lib/stores/assistant';

	export let message: ChatMessageType;

	let parsedContent = '';

	// --- Library Config ---
	hljs.registerLanguage('python', python);
	hljs.registerLanguage('diff', diff);
	marked.setOptions({
		gfm: true,
		breaks: true,
		highlight: (code, lang) => {
			const language = hljs.getLanguage(lang) ? lang : 'plaintext';
			return hljs.highlight(code, { language }).value;
		}
	});

	// --- Reactive Rendering Logic ---
	$: if (browser && message.type === 'message') {
		try {
			parsedContent = marked.parse(message.content || '');
		} catch (e) {
			console.error('Markdown Parsing Error:', e);
			parsedContent = '<p>Error: Could not display message content.</p>';
		}
	}

	// --- Helper Functions ---
	function getFilenameFromPatch(patch: string): string {
		const match = patch.match(/^\+\+\+ b\/(.+)/m);
		return match ? match[1] : 'script.py';
	}

	function extractCodeFromPatch(patch: string): string {
		const addedLines = patch.match(/^\+(?!.*\+\+\+.*$).*/gm);
		if (!addedLines) return '';
		return addedLines.map((line) => line.substring(1)).join('\n');
	}

	function handleApplyPatch(event: MouseEvent) {
		if (message.type !== 'tool_code_edit' || !message.toolPayload?.patch) return;

		const button = event.currentTarget as HTMLButtonElement;
		const originalCode = get(pythonConsoleStore).code;
		const patch = message.toolPayload.patch;

		try {
			const newCode = applyPatch(originalCode, patch);
			if (newCode === false) {
				throw new Error('Patch could not be applied cleanly. The content does not match the patch.');
			}
			pythonConsoleStore.setCode(newCode);
			button.innerText = 'Applied!';
			button.disabled = true;
		} catch (e: any) {
			console.warn(`Standard patch failed: ${e.message}. Attempting fallback to full replacement.`);
			try {
				const extractedCode = extractCodeFromPatch(patch);
				pythonConsoleStore.setCode(extractedCode);
				button.innerText = 'Applied!';
				button.disabled = true;
			} catch (fallbackError: any) {
				alert(`A critical error occurred during the patch fallback routine: ${fallbackError.message}`);
			}
		}
	}
</script>

{#if message.type === 'tool_code_edit' && message.toolPayload}
	<div class="tool-call-container">
		<div class="explanation">{@html marked.parse(message.content)}</div>

		{#if message.toolPayload.edit_type === 'APPLY_DIFF_PATCH' && message.toolPayload.patch}
			<div class="code-block-container">
				<div class="code-block-header">
					<span class="filename">{getFilenameFromPatch(message.toolPayload.patch)}</span>
					<button on:click={handleApplyPatch}>Apply Patch</button>
				</div>
				<pre
					class="language-diff"><code>{@html hljs.highlight(message.toolPayload.patch, { language: 'diff' }).value}</code></pre>
			</div>
		{:else if message.toolPayload.edit_type === 'REPLACE_ENTIRE_SCRIPT' && message.toolPayload.code}
			<div class="code-block-container">
				<div class="code-block-header">
					<span class="filename">script.py</span>
					<button on:click={() => pythonConsoleStore.setCode(message.toolPayload?.code || '')}>
						Load in Editor
					</button>
				</div>
				<pre
					class="language-python"><code>{@html hljs.highlight(message.toolPayload.code, { language: 'python' }).value}</code></pre>
			</div>
		{/if}
	</div>
{:else if message.type === 'message'}
	<div class="message-content">
		{@html parsedContent}
	</div>
{/if}

<style>
	.tool-call-container {
		width: 100%;
	}
	.explanation {
		margin-bottom: 0.75rem;
	}

	.code-block-container {
		border: 1px solid #444;
		border-radius: 6px;
		background-color: #1e1e1e;
		overflow: hidden;
		margin-top: 0.5rem;
	}

	.code-block-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background-color: #2d2d2d;
		padding: 0.3rem 0.3rem 0.3rem 0.8rem;
		border-bottom: 1px solid #444;
	}

	.code-block-header .filename {
		font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
		font-size: 12px;
		color: #ccc;
	}

	.code-block-header button {
		background-color: #007acc;
		color: white;
		border: none;
		padding: 4px 10px;
		border-radius: 5px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		transition: background-color 0.2s;
	}

	.code-block-header button:hover {
		background-color: #005a99;
	}

	.code-block-header button:disabled {
		background-color: #4caf50;
		cursor: default;
	}

	.code-block-container pre {
		margin: 0 !important;
		border: none !important;
		border-radius: 0 0 4px 4px;
		padding: 0.8rem;
	}

	/* --- THIS IS THE FIX --- */
	.message-content :global(p) {
		margin: 0; /* Remove default margins from marked.js's <p> tags */
		display: inline; /* Make the paragraph only as wide as its text content */
		/* Using 'inline' is often simpler than 'inline-block' if no block properties are needed */
	}
</style>
