// ─────────────────────────────────────────────────────────────────────────────
// PYTHON CONSOLE CUSTOM STORE
// This file defines a "custom Svelte store". Instead of just being a simple
// `writable`, it's an object that bundles multiple pieces of state (`code`,
// `output`, etc.) and the functions (`setCode`, `executeInteractive`, etc.)
// that operate on that state. This is a powerful pattern for organizing
// related logic and keeping your components clean.
// ─────────────────────────────────────────────────────────────────────────────

import { writable, get } from 'svelte/store';
import type { InteractiveResponse } from '$lib/api/types';
import { executeInteractivePython } from '$lib/api/pythonClient';

// -----------------------------------------------------------------------------
// STORE STATE INTERFACE
// We define the "shape" of our store's data. This ensures type safety and
// makes it clear what information the store is responsible for.
// -----------------------------------------------------------------------------
interface PythonConsoleState {
    code: string;                      // The current Python code in the editor
    output: string[];                  // Accumulated console output lines
    lastError: string | null;          // The most recent traceback, if any
    isOpen: boolean;                   // Is the output panel visible?
    cursor: { line: number; ch: number }; // Editor cursor position
}

// -----------------------------------------------------------------------------
// INITIAL STATE
// Defines the default values for the store when the application first loads.
// -----------------------------------------------------------------------------
const initial: PythonConsoleState = {
    code: `# Write Python here.\n# Use Vim keys, Ctrl-Space for completions.\nprint("Hello UIAgent")\n`,
    output: [],
    lastError: null,
    isOpen: false,
    cursor: { line: 0, ch: 0 },
};

// -----------------------------------------------------------------------------
// STORE CREATION FACTORY
// This function creates and returns our store object. It's the standard Svelte
// custom store pattern.
// -----------------------------------------------------------------------------
function createPythonConsoleStore() {
    // We create a `writable` store internally to hold our state object.
    const state = writable<PythonConsoleState>({ ...initial });
    const { subscribe, update, set } = state;

    // We return an object containing the `subscribe` method (which is required
    // for Svelte's reactivity) and our custom methods (actions).
    return {
        // Expose the mandatory `subscribe` method so components can listen for changes.
        subscribe,

        // ACTION: Update the code in the store's state.
        setCode: (newCode: string) =>
            update((s) => {
                s.code = newCode;
                return s;
            }),

        // ACTION: Update the cursor position.
        setCursor: (pos: { line: number; ch: number }) =>
            update((s) => {
                s.cursor = pos;
                return s;
            }),

        // ACTION: Clear all console output and the stored lastError.
        clearOutput: () =>
            update((s) => {
                s.output = [];
                s.lastError = null;
                return s;
            }),

        // ACTION: Append new lines to the console output.
        appendOutput: (text: string) =>
            update((s) => {
                const lines = text.split(/\r?\n/).filter((l) => l !== '');
                s.output = [...s.output, ...lines];
                return s;
            }),

        // ACTION: Specifically store the last traceback for the LLM Assistant to use.
        setLastError: (err: string) =>
            update((s) => {
                s.lastError = err;
                return s;
            }),

        // ACTIONS: Control the visibility of the console panel.
        open: () => update((s) => ((s.isOpen = true), s)),
        close: () => update((s) => ((s.isOpen = false), s)),
        toggleOpen: () => update((s) => ((s.isOpen = !s.isOpen), s)),

        // ACTION: Execute the current code via the API.
        // This is a great example of co-locating an action with the state it depends on.
        executeInteractive: async (
            serial: string,
            enableTracing: boolean = false
        ): Promise<InteractiveResponse> => {
            // `get(state)` gives us a one-time snapshot of the current state.
            const { code } = get(state);

            // Delegate the actual `fetch` call to our clean API client.
            const resp = await executeInteractivePython(
                serial,
                code,
                enableTracing
            );
            return resp;
        },

        // ACTION: Reset the entire store back to its initial state.
        reset: () => set({ ...initial }),
    };
}

// Finally, we create a single instance of our store and export it.
// Any Svelte component can now import this `pythonConsoleStore` and use it.
export const pythonConsoleStore = createPythonConsoleStore();

