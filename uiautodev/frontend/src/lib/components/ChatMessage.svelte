<script lang="ts">
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import hljs from 'highlight.js/lib/core';
	import python from 'highlight.js/lib/languages/python';
	import 'highlight.js/styles/github-dark.css';

	import { pythonConsoleStore } from '$lib/stores/pythonConsole';
	import type { ChatMessage as ChatMessageType } from '$lib/stores/assistant';

	export let message: ChatMessageType;

	let parsedContent = '';

	// --- Library Configuration ---
	// We only need to register the python language now.
	hljs.registerLanguage('python', python);

	marked.setOptions({
		gfm: true,
		breaks: true,
		highlight: (code, lang) => {
			const language = hljs.getLanguage(lang) ? lang : 'plaintext';
			return hljs.highlight(code, { language }).value;
		}
	});

	// --- Reactive Rendering for Standard Messages ---
	$: if (browser && message.type === 'message') {
		try {
			parsedContent = marked.parse(message.content || '');
		} catch (e) {
			console.error('Markdown Parsing Error:', e);
			parsedContent = '<p>Error: Could not display message content.</p>';
		}
	}

	// ---
	// --- ✅ FINAL ACTION-BASED EDIT LOGIC
	// ---

	/**
	 * Handles the 'Apply Edit' button click.
	 * It dispatches the REPLACE_BLOCK action to the pythonConsoleStore.
	 */
	function handleApplyReplacement(event: MouseEvent) {
		const payload = message.toolPayload;
		if (
			!payload ||
			payload.edit_type !== 'REPLACE_BLOCK' ||
			payload.start_line === undefined ||
			payload.end_line === undefined ||
			payload.code === undefined
		) {
			console.error('Invalid payload for handleApplyReplacement:', payload);
			alert('Cannot apply edit: The suggestion from the assistant was incomplete.');
			return;
		}

		const button = event.currentTarget as HTMLButtonElement;

		pythonConsoleStore.dispatchReplaceAction({
			start_line: payload.start_line,
			end_line: payload.end_line,
			code: payload.code
		});

		button.innerText = 'Applied';
		button.disabled = true;
	}

	/**
	 * Handles the 'Load in Editor' button for full script replacements.
	 */
	function handleLoadScript(event: MouseEvent) {
		if (message.type !== 'tool_code_edit' || !message.toolPayload?.code) return;
		const button = event.currentTarget as HTMLButtonElement;
		pythonConsoleStore.setCode(message.toolPayload.code || '');
		button.innerText = 'Loaded';
		button.disabled = true;
	}
</script>

{#if message.type === 'tool_code_edit' && message.toolPayload}
	<div class="tool-call-container">
		<div class="explanation">{@html marked.parse(message.content)}</div>

		{#if message.toolPayload.edit_type === 'REPLACE_BLOCK' && message.toolPayload.code !== undefined}
			<div class="code-block-container">
				<div class="code-block-header">
					<span>Suggested Edit</span>
					<button on:click={handleApplyReplacement}>Apply Edit</button>
				</div>
				<pre
					class="language-python"><code>{@html hljs.highlight(message.toolPayload.code, { language: 'python' }).value}</code></pre>
			</div>
		{:else if message.toolPayload.edit_type === 'REPLACE_ENTIRE_SCRIPT' && message.toolPayload.code}
			<div class="code-block-container">
				<div class="code-block-header">
					<span>script.py</span>
					<button on:click={handleLoadScript}> Load in Editor </button>
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
	/* Styles are unchanged */
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
	.code-block-header span {
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
	.code-block-header button:hover:not(:disabled) {
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
	.message-content :global(p) {
		margin: 0;
		display: inline;
	}
</style>

