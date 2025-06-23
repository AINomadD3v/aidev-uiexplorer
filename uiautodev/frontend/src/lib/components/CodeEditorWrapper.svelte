<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';

	// ─── CODE MIRROR 6 IMPORTS ──────────────────────────────────────────────────────────────────
	// We now import specific modules for the state, view, and features we need.
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
	import { python } from '@codemirror/lang-python';
	import { vim } from '@replit/codemirror-vim';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { defaultKeymap, history, indentWithTab } from '@codemirror/commands';
	import { autocompletion } from '@codemirror/autocomplete';
	import { bracketMatching } from '@codemirror/language';

	// ─── SVELTE STORE IMPORT ────────────────────────────────────────────────────────────────────
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';

	// ─── PROPS ──────────────────────────────────────────────────────────────────────────────────
	// The `visible` prop is still useful for telling the editor when to refresh its layout.
	export let visible: boolean = true;

	// ─── LOCAL STATE ────────────────────────────────────────────────────────────────────────────
	let editorEl: HTMLDivElement;
	let view: EditorView; // This will hold the CodeMirror 6 view instance.

	onMount(() => {
		if (!browser) return;

		// This listener is a CodeMirror 6 extension that syncs our editor's state
		// back to our Svelte store whenever a change occurs.
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				pythonConsoleStore.setCode(update.state.doc.toString());
			}
			if (update.selectionSet) {
				const pos = update.state.selection.main;
				pythonConsoleStore.setCursor({ line: pos.from, ch: pos.to });
			}
		});

		// We assemble all editor features into an array of extensions.
		const extensions = [
			lineNumbers(),
			history(),
			bracketMatching(),
			highlightActiveLine(),
			autocompletion(),
			python(),
			oneDark, // The theme is now just an extension
			vim(),
			keymap.of([...defaultKeymap, indentWithTab]),
			updateListener // Our custom listener to sync state
		];

		// We get the initial state from our Svelte store.
		const initialCode = get(pythonConsoleStore).code;
		const initialState = EditorState.create({
			doc: initialCode,
			extensions: extensions
		});

		// Finally, create the editor view and attach it to our <div>.
		view = new EditorView({
			state: initialState,
			parent: editorEl
		});
	});

	// This reactive block listens for changes in our Svelte store.
	// If the code is changed programmatically (e.g., by the LLM Assistant),
	// it dispatches a transaction to update the editor view.
	$: if (view && $pythonConsoleStore.code !== view.state.doc.toString()) {
		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: $pythonConsoleStore.code
			}
		});
	}

	// This reactive block refreshes the editor when it becomes visible,
	// which can fix rendering glitches when a parent tab is switched.
	$: if (view && visible) {
		view.focus();
	}

	onDestroy(() => {
		// This is the proper way to clean up a CodeMirror 6 editor instance.
		if (view) {
			view.destroy();
		}
	});
</script>

<style>
	/* The main editor class for CM6 is .cm-editor */
	.editor-container,
	:global(.cm-editor) {
		height: 100%;
		width: 100%;
		font-family: var(--font-family-monospace);
		font-size: 13px;
	}
</style>

<div class="editor-container" bind:this={editorEl}></div>
