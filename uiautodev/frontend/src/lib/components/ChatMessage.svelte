<script lang="ts">
	import { tick } from 'svelte';
	import { marked } from 'marked';
	import hljs from 'highlight.js/lib/core';
	import python from 'highlight.js/lib/languages/python';
	import 'highlight.js/styles/github-dark.css';

	// ─── SVELTE STORE IMPORT ──────────────────────────────────────────────────────────────────
	// This is the key change. We import the store directly to make this component
	// self-sufficient and decoupled from its parent.
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';

	// ─── PROPS ───────────────────────────────────────────────────────────────────────────────
	// The component now only needs the raw markdown content.
	export let rawContent: string;

	// ─── LOCAL STATE ─────────────────────────────────────────────────────────────────────────
	let messageElement: HTMLDivElement;
	let renderedHtml = '';

	// ─── LIBRARY CONFIG (UNCHANGED) ──────────────────────────────────────────────────────────
	// This only needs to be done once.
	hljs.registerLanguage('python', python);
	marked.setOptions({
		gfm: true,
		breaks: true,
		highlight: (code, lang) => {
			const language = hljs.getLanguage(lang) ? lang : 'plaintext';
			return hljs.highlight(code, { language }).value;
		}
	});

	// ─── REACTIVE RENDER LOGIC ───────────────────────────────────────────────────────────────
	// This block runs whenever `rawContent` changes. It renders the markdown and then
	// uses `tick()` to wait for the DOM to update before adding our action buttons.
	$: if (rawContent && typeof window !== 'undefined') {
		renderedHtml = marked.parse(rawContent);

		tick().then(() => {
			if (!messageElement) return;

			messageElement.querySelectorAll('pre').forEach((pre) => {
				// Prevent adding buttons multiple times during re-renders
				if (pre.querySelector('.code-actions')) return;

				const code = pre.querySelector('code')?.innerText || '';
				if (!code) return;

				const actionsContainer = document.createElement('div');
				actionsContainer.className = 'code-actions';

				// --- REFACTORED "COPY" BUTTON ---
				const copyBtn = document.createElement('button');
				copyBtn.innerText = 'Copy';
				copyBtn.title = 'Copy code to clipboard';
				copyBtn.onclick = () => {
					navigator.clipboard.writeText(code);
					// Provide self-contained feedback instead of calling a prop
					copyBtn.innerText = 'Copied!';
					setTimeout(() => {
						copyBtn.innerText = 'Copy';
					}, 2000);
				};

				// --- REFACTORED "TO CONSOLE" BUTTON ---
				const toConsoleBtn = document.createElement('button');
				toConsoleBtn.innerText = 'To Console';
				toConsoleBtn.title = 'Send code to the Python Console';
				toConsoleBtn.onclick = () => {
					// Directly call the methods on our imported store
					pythonConsoleStore.setCode(code);
					pythonConsoleStore.open(); // Ensures the output panel is visible

					// Provide self-contained feedback
					toConsoleBtn.innerText = 'Sent!';
					setTimeout(() => {
						toConsoleBtn.innerText = 'To Console';
					}, 2000);
				};

				actionsContainer.appendChild(copyBtn);
				actionsContainer.appendChild(toConsoleBtn);
				pre.appendChild(actionsContainer);
			});
		});
	}
</script>

<div bind:this={messageElement}>
	{@html renderedHtml}
</div>
