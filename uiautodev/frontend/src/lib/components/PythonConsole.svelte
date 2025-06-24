<!-- frontend/src/lib/components/PythonConsole.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import CodeEditorWrapper from './CodeEditorWrapper.svelte';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';
	
	// ✅ Import the (to be created) interrupt function from your API client.
	import { interruptExecution } from '$lib/api/pythonClient';

	export let serial: string;

	async function runCode() {
		if (!browser || !serial) {
			alert('Please select a device first.');
			return;
		}

		pythonConsoleStore.open();
		pythonConsoleStore.clearOutput();
		pythonConsoleStore.appendOutput('⏳ Running script...');

		try {
			const data = await pythonConsoleStore.executeInteractive(serial);

			pythonConsoleStore.clearOutput();

			let out = '';
			if (data.stdout) out += data.stdout;
			if (data.result != null) out += `\n>>> ${data.result}\n`;
			if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
			if (data.execution_error) {
				out += `\n--- ERROR ---\n${data.execution_error}`;
				pythonConsoleStore.setLastError(data.execution_error);
			}

			pythonConsoleStore.appendOutput(out.trim() || '# (The script ran with no output)');
		} catch (e: any) {
			const errorMsg = `Error calling backend: ${e.message || e}`;
			pythonConsoleStore.clearOutput();
			pythonConsoleStore.appendOutput(errorMsg);
			pythonConsoleStore.setLastError(errorMsg);
			// The finally block in the store's executeInteractive will handle setting isRunning to false.
		}
	}

	/** ✅ NEW: This function calls the backend to stop the current script. */
	async function stopCode() {
		if (!browser) return;
		console.log('Attempting to stop script execution...');
		try {
			await interruptExecution();
			pythonConsoleStore.appendOutput('\n⏹️ Execution stop request sent.');
			// The store will set isRunning to false automatically when executeInteractive finishes.
			// For immediate feedback, we could also call pythonConsoleStore.setIsRunning(false) here.
		} catch (e: any) {
			pythonConsoleStore.appendOutput(`\nFailed to send stop signal: ${e.message}`);
		}
	}
</script>

<div class="console-container">
	<div class="editor-wrapper">
		<CodeEditorWrapper visible={true} />
	</div>

	<div class="toolbar">
        <!-- ✅ NEW: Conditionally render Run or Stop button -->
		{#if $pythonConsoleStore.isRunning}
			<button class="stop-button" on:click={stopCode}>⏹️ Stop Code</button>
		{:else}
			<button on:click={runCode}>▶️ Run Code</button>
		{/if}

		<button on:click={pythonConsoleStore.toggleOpen}>
			{#if $pythonConsoleStore.isOpen}Hide Output{:else}Show Output{/if}
		</button>
	</div>
</div>

<style>
	.console-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		background: #1e1e1e;
	}
	.editor-wrapper {
		flex-grow: 1;
		position: relative;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		border-top: 1px solid #333;
		flex-shrink: 0;
	}
	.toolbar button {
		padding: 0.5rem 1rem;
		background: #3c3c3c;
		border: 1px solid #555;
		color: #ddd;
		border-radius: 5px;
		cursor: pointer;
		font-weight: 500;
		transition: background-color 0.2s ease;
	}
	.toolbar button:hover {
		background: #4f4f4f;
	}
	/** ✅ NEW: Style for the stop button */
	.toolbar button.stop-button {
		background-color: #a13d3d;
		border-color: #c55a5a;
	}
	.toolbar button.stop-button:hover {
		background-color: #b84a4a;
	}
</style>

