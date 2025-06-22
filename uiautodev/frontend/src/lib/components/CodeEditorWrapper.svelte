<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { browser } from '$app/environment';

    // ---------------------------------------------------------------------------------
    // REFACTOR STEP 1: DIRECT STORE IMPORT
    // Instead of using props and dispatch, we import the store directly. This is the
    // key to making this component self-sufficient.
    // ---------------------------------------------------------------------------------
    import { pythonConsoleStore } from '$lib/stores/pythonConsole';

    // ---------------------------------------------------------------------------------
    // REFACTOR STEP 2: REMOVE PROPS AND DISPATCH
    // We no longer need to receive code/cursor info as props or dispatch events,
    // because we will now sync directly with the store. The `visible` prop is
    // still useful for knowing when to refresh the editor's view.
    // ---------------------------------------------------------------------------------
    export let visible: boolean = true;
    // REMOVED: export let code: string = '';
    // REMOVED: export let line: number = 0;
    // REMOVED: export let ch: number = 0;
    // REMOVED: const dispatch = createEventDispatcher<...>();

    let textareaEl: HTMLTextAreaElement;
    let editor: any; // This will hold the CodeMirror editor instance.

    onMount(async () => {
        if (!browser) return;

        // Polyfill for CodeMirror UMD module (unchanged)
        if (typeof (window as any).self === 'undefined') {
            (window as any).self = window;
        }

        // Dynamic import of CodeMirror and its addons (unchanged)
        const { default: CodeMirror } = await import('codemirror');
        await Promise.all([
            import('codemirror/mode/python/python'),
            import('codemirror/keymap/vim'),
            import('codemirror/addon/hint/show-hint'),
            import('codemirror/addon/hint/anyword-hint'),
            import('codemirror/addon/selection/active-line'),
            import('codemirror/addon/edit/matchbrackets'),
        ]);

        // Initialize CodeMirror editor (unchanged)
        editor = CodeMirror.fromTextArea(textareaEl, {
            mode: 'python',
            keyMap: 'vim',
            theme: 'material-darker',
            lineNumbers: true,
            styleActiveLine: true,
            matchBrackets: true,
            extraKeys: {
                'Ctrl-Space': 'autocomplete',
                '.': (cm: any) => {
                    cm.replaceSelection('.');
                    setTimeout(() => cm.execCommand('autocomplete'), 50);
                },
            },
            hintOptions: {
                hint: (CodeMirror as any).hint.anyword,
                completeSingle: false,
                alignWithWord: true,
            },
        });

        // ---------------------------------------------------------------------------------
        // REFACTOR STEP 3: INITIALIZE EDITOR FROM THE STORE
        // We get the initial code and cursor position directly from our store.
        // The `get()` function from 'svelte/store' gives us a one-time snapshot.
        // ---------------------------------------------------------------------------------
        const { get } = await import('svelte/store');
        const currentState = get(pythonConsoleStore);
        editor.setValue(currentState.code);
        editor.setCursor(currentState.cursor);

        // ---------------------------------------------------------------------------------
        // REFACTOR STEP 4: WRITE CHANGES BACK TO THE STORE
        // In the editor's event listeners, instead of dispatching an event, we now
        // directly call the appropriate method on our imported store.
        // ---------------------------------------------------------------------------------
        editor.on('changes', (cm: any) => {
            // No more dispatch! Just update the store directly.
            pythonConsoleStore.setCode(cm.getValue());
        });
        editor.on('cursorActivity', (cm: any) => {
            const pos = cm.getCursor();
            // Update the cursor in the store directly.
            pythonConsoleStore.setCursor({ line: pos.line, ch: pos.ch });
        });

        // Wait for parent to lay out and then refresh (unchanged)
        await tick();
        editor.refresh();
    });

    // ---------------------------------------------------------------------------------
    // REFACTOR STEP 5: REACTIVELY SYNC EXTERNAL CHANGES
    // This reactive block (`$:`) listens for changes to the `code` value inside
    // our store. If another component (like the LLM Assistant) programmatically
    // updates the code in the store, this block will run and update the editor's
    // content to match. This ensures the editor is always in sync.
    // We use `$pythonConsoleStore` which is Svelte's auto-subscription syntax.
    // ---------------------------------------------------------------------------------
    $: if (editor && $pythonConsoleStore.code !== editor.getValue()) {
        const pos = editor.getCursor(); // Save cursor position
        editor.setValue($pythonConsoleStore.code);
        editor.setCursor(pos); // Restore cursor position
    }

    // Refresh when visibility changes (unchanged)
    $: if (editor && visible) {
        editor.refresh();
    }

    onDestroy(() => {
        if (editor) {
            editor.toTextArea();
        }
    });
</script>

<style>
    /* Styles are unchanged */
    :global(.CodeMirror) {
        height: 100% !important;
        width: 100%;
        font-family: var(--font-family-monospace);
        font-size: 13px;
    }
</style>

<!-- This textarea is the mounting point for the CodeMirror editor -->
<textarea bind:this={textareaEl} style="display: none;"></textarea>

