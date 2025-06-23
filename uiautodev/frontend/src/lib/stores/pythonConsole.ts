/**
 * @file This custom Svelte store manages the complete state for the Python Console.
 * It bundles the state (code, output, etc.) and the actions that can modify that state,
 * creating a self-contained and reusable module for the console's logic.
 */

import { writable, get } from 'svelte/store';
import type { InteractiveResponse } from '$lib/api/types';
import { executeInteractivePython } from '$lib/api/pythonClient';

/** Defines the shape of the data managed by the python console store. */
interface PythonConsoleState {
	/** The current Python code in the editor. */
	code: string;
	/** An array of accumulated output lines from executed code. */
	output: string[];
	/** The most recent traceback string, if an error occurred. */
	lastError: string | null;
	/** Controls the visibility of the console's output panel. */
	isOpen: boolean;
	/** The editor's last known cursor position. */
	cursor: { line: number; ch: number };
}

/** The default state for the console when the application first loads. */
const initialState: PythonConsoleState = {
	code: `# Write Python here.\n# Use Vim keys, Ctrl-Space for completions.\nprint("Hello UIAgent")\n`,
	output: [],
	lastError: null,
	isOpen: false,
	cursor: { line: 0, ch: 0 }
};

/** Factory function that creates the custom store object. */
function createPythonConsoleStore() {
	const { subscribe, update, set } = writable<PythonConsoleState>({ ...initialState });

	return {
		/** Allows Svelte components to subscribe to state changes. */
		subscribe,

		/** Replaces the entire editor content with new code. Used by the LLM to apply suggestions. */
		applyPatch: (newCode: string) =>
			update((s) => {
				s.code = newCode;
				return s;
			}),

		/** Updates the code in the store. Primarily called by the editor component on user input. */
		setCode: (newCode: string) =>
			update((s) => {
				s.code = newCode;
				return s;
			}),

		/** Updates the cursor position in the store. */
		setCursor: (pos: { line: number; ch: number }) =>
			update((s) => {
				s.cursor = pos;
				return s;
			}),

		/** Clears all console output and the stored error message. */
		clearOutput: () =>
			update((s) => {
				s.output = [];
				s.lastError = null;
				return s;
			}),

		/** Appends new lines to the console output. */
		appendOutput: (text: string) =>
			update((s) => {
				const lines = text.split(/\r?\n/).filter((l) => l !== '');
				s.output = [...s.output, ...lines];
				return s;
			}),

		/** Stores the last error traceback for the LLM to potentially use as context. */
		setLastError: (err: string) =>
			update((s) => {
				s.lastError = err;
				return s;
			}),

		/** Controls the visibility of the console's output panel. */
		open: () => update((s) => ((s.isOpen = true), s)),
		close: () => update((s) => ((s.isOpen = false), s)),
		toggleOpen: () => update((s) => ((s.isOpen = !s.isOpen), s)),

		/** Executes the current code in the editor via the backend API. */
		executeInteractive: async (
			serial: string,
			enableTracing: boolean = false
		): Promise<InteractiveResponse> => {
			const { code } = get({ subscribe });
			const resp = await executeInteractivePython(serial, code, enableTracing);
			return resp;
		},

		/** Resets the entire store back to its default state. */
		reset: () => set({ ...initialState })
	};
}

/** The singleton instance of the python console store, exported for use in any component. */
export const pythonConsoleStore = createPythonConsoleStore();
