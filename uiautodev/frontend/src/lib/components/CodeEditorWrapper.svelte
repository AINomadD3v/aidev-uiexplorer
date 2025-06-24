<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';

	// ─── CODE MIRROR 6 IMPORTS ──────────────────────────────────────────────────────────────────
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
	import { python } from '@codemirror/lang-python';
	import { vim } from '@replit/codemirror-vim';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { defaultKeymap, history, indentWithTab } from '@codemirror/commands';
	import { autocompletion } from '@codemirror/autocomplete';
	import { bracketMatching } from '@codemirror/language';

	// ─── SVELTE STORE IMPORT ────────────────────────────────────────────────────────────────────
	import { pythonConsoleStore, type ReplaceActionPayload } from '$lib/stores/pythonConsole';

	// ─── PROPS ──────────────────────────────────────────────────────────────────────────────────
	export let visible: boolean = true;

	// ─── LOCAL STATE ────────────────────────────────────────────────────────────────────────────
	let editorEl: HTMLDivElement;
	let view: EditorView; // This will hold the CodeMirror 6 view instance.

	onMount(() => {
		if (!browser) return;

		// This listener syncs the editor's state back to our Svelte store on user input.
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				// This is a one-way sync: from editor TO store.
				// We do this to ensure the store always has the latest code as typed by the user.
				// The store will NOT programmatically update the editor via this path.
				const currentStoreCode = get(pythonConsoleStore).code;
				const newEditorCode = update.state.doc.toString();
				if (currentStoreCode !== newEditorCode) {
					pythonConsoleStore.setCode(newEditorCode);
				}
			}
			if (update.selectionSet) {
				const pos = update.state.selection.main;
				pythonConsoleStore.setCursor({ line: pos.from, ch: pos.to });
			}
		});

		const extensions = [
			lineNumbers(),
			history(),
			bracketMatching(),
			highlightActiveLine(),
			autocompletion(),
			python(),
			oneDark,
			vim(),
			keymap.of([...defaultKeymap, indentWithTab]),
			updateListener
		];

		const initialCode = get(pythonConsoleStore).code;
		const initialState = EditorState.create({
			doc: initialCode,
			extensions: extensions
		});

		view = new EditorView({
			state: initialState,
			parent: editorEl
		});
	});

	// ---
	// --- ✅ NEW: ACTION-HANDLING REACTIVE BLOCK
	// ---
	// This is the core of the new, robust architecture. It subscribes to changes
	// in the `lastAction` property of our pythonConsoleStore.
	$: if (view && $pythonConsoleStore.lastAction) {
		const action = $pythonConsoleStore.lastAction;

		// We only handle 'REPLACE_BLOCK' actions here.
		if (action.type === 'REPLACE_BLOCK') {
			console.log('Action received by CodeEditorWrapper:', action);

			const { start_line, end_line, code } = action;
			const doc = view.state.doc;

			// Convert 1-based line numbers from the LLM to 0-based positions for CodeMirror.
			// Clamp values to be within the document's bounds to prevent errors.
			const fromLine = Math.min(Math.max(start_line, 1), doc.lines);
			const toLine = Math.min(Math.max(end_line, 1), doc.lines);

			const fromPos = doc.line(fromLine).from;
			const toPos = doc.line(toLine).to;

			// Dispatch a transaction to the editor to perform the replacement.
			// This is the correct, atomic way to modify a CodeMirror 6 document.
			view.dispatch({
				changes: {
					from: fromPos,
					to: toPos,
					insert: code
				}
			});

			// After handling the action, we immediately clear it from the store
			// to prevent it from being re-triggered on the next state change.
			$pythonConsoleStore.lastAction = null;
		}
	}

	// This reactive block handles full script replacements, which is a simpler case.
	$: if (
		view &&
		$pythonConsoleStore.code !== view.state.doc.toString() &&
		!$pythonConsoleStore.lastAction // Only run if no action is pending
	) {
		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: $pythonConsoleStore.code
			}
		});
	}

	// Refreshes the editor when its container becomes visible.
	$: if (view && visible) {
		view.focus();
	}

	onDestroy(() => {
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


