<!-- frontend/src/lib/components/PythonConsole.svelte -->
<script lang="ts">
	// ─── SVELTE IMPORTS ──────────────────────────────────────────────────────────────────────────
	import { browser } from '$app/environment';

	// ─── CHILD COMPONENT IMPORTS ────────────────────────────────────────────────────────────────
	import CodeEditorWrapper from './CodeEditorWrapper.svelte';
	import ConsoleOutput from './ConsoleOutput.svelte';

	// ─── SVELTE STORE IMPORT ────────────────────────────────────────────────────────────────────
	// This is the key change. We import the store which will now manage all of this
	// component's state (code, output, visibility, etc.).
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';

	// ─── PROPS ──────────────────────────────────────────────────────────────────────────────────
	// The component still needs to know which device to run the code on.
	export let serial: string;

	// ─── LOCAL STATE REMOVED ────────────────────────────────────────────────────────────────────
	// All of these local variables have been removed because their state is now
	// managed centrally in `pythonConsoleStore`.
	// let script = ''; 				// REMOVED
	// let cursor = { line: 0, ch: 0 }; // REMOVED
	// let output = ''; 				// REMOVED
	// let showOutput = false; 			// REMOVED

	// ─── REFACTORED "RUN CODE" ACTION ───────────────────────────────────────────────────────────
	// This function is now much simpler. It just delegates the execution logic to the
	// action already defined in our custom store.
	async function runCode() {
		if (!browser) return;
		if (!serial) {
			// This can be replaced with a non-blocking toast/notification later.
			alert('Please select a device first.');
			return;
		}

		// Set a loading state in the console output
		pythonConsoleStore.open();
		pythonConsoleStore.clearOutput();
		pythonConsoleStore.appendOutput('⏳ running…');

		try {
			// Call the action on the store. The store already knows what code to run.
			const data = await pythonConsoleStore.executeInteractive(serial);

			// The action was successful, so clear the "running..." message.
			pythonConsoleStore.clearOutput();

			// Format and append the actual results.
			let out = '';
			if (data.stdout) out += data.stdout;
			if (data.result != null) out += `\n>>> ${data.result}\n`;
			if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
			if (data.execution_error) {
				out += `\n--- ERROR ---\n${data.execution_error}`;
				// The store has a dedicated place for the last error, let's use it.
				pythonConsoleStore.setLastError(data.execution_error);
			}

			pythonConsoleStore.appendOutput(out.trim() || '# (no output)');
		} catch (e: any) {
			const errorMsg = `Error calling backend: ${e.message || e}`;
			pythonConsoleStore.clearOutput();
			pythonConsoleStore.appendOutput(errorMsg);
			pythonConsoleStore.setLastError(errorMsg); // Also store the error here.
		}
	}

	// The `toggleOutput` function has been removed. The button will call the store directly.
</script>

<style>
	/* All styles are unchanged */
	.console-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--dark-bg-secondary);
	}
	.editor-wrapper {
		flex: 1;
		position: relative;
	}
	.toolbar {
		display: flex;
		gap: 0.5em;
		padding: 0.5em;
		background: var(--dark-bg-tertiary);
		border-top: 1px solid var(--dark-border-primary);
	}
	.toolbar button {
		padding: 0.4em 0.8em;
		background: var(--dark-bg-hover);
		border: 1px solid var(--dark-border-primary);
		color: var(--dark-text-primary);
		border-radius: 3px;
		cursor: pointer;
	}
	.toolbar button:hover {
		background: var(--dark-accent-hover);
	}
	.output-panel {
		flex: 1;
		overflow: auto;
	}
</style>

<!-- ─── REFACTORED TEMPLATE ─────────────────────────────────────────────────────────────────── -->
<div class="console-container">
	<!-- Code editor -->
	<div class="editor-wrapper">
		<!--
            The CodeEditorWrapper now syncs with the store internally. We no longer
            need to bind its values here, making this component much cleaner.
        -->
		<CodeEditorWrapper visible={$pythonConsoleStore.isOpen} />
	</div>

	<!-- Run / Toggle UI -->
	<div class="toolbar">
		<button on:click={runCode}>▶️ Run Code</button>
		<!-- This button now calls the store's action directly. -->
		<button on:click={pythonConsoleStore.toggleOpen}>
			<!-- The text is now determined by the store's `isOpen` state. -->
			{#if $pythonConsoleStore.isOpen}Hide Output{:else}Show Output{/if}
		</button>
	</div>

	<!-- Output -->
	<!-- Visibility is now controlled by the store's `isOpen` state. -->
	{#if $pythonConsoleStore.isOpen}
		<div class="output-panel">
			<!-- The output content is now read from the store's `output` array. -->
			<ConsoleOutput output={$pythonConsoleStore.output.join('\n')} />
		</div>
	{/if}
</div>
