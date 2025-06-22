<script lang="ts">
	// ─── SVELTE & STORE IMPORTS ─────────────────────────────────────────────────────────────────
	import { onMount } from 'svelte';
	// `writable` is no longer needed here as we don't create local stores for messages
	import { get, derived } from 'svelte/store';
	import ChatMessage from '$lib/components/ChatMessage.svelte';

	// ─── CENTRAL STORES ──────────────────────────────────────────────────────────────────────────
	import { selectedSerial, selectedNode, devices, multiSelectedNodes } from '$lib/stores/uiagent';
	import { hierarchy } from '$lib/stores/hierarchy';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';
	import { sendChatMessage } from '$lib/api/pythonClient';

	// ✅ STEP 1: IMPORT THE SHARED CHAT STORE
	// We will use this store as the single source of truth for the conversation.
	import { chatMessages } from '$lib/stores/assistant';

	// ─── LOCAL COMPONENT STATE ──────────────────────────────────────────────────────────────────
	// The state for the chat messages has been removed from here.
	// The remaining local state is for UI controls specific to this component.
	// ❌ STEP 2: REMOVE THE LOCAL MESSAGE STATE
	// interface Message { ... } // REMOVED
	// const messages = writable<Message[]>([]); // REMOVED

	let promptText = '';
	let model: 'deepseek' | 'openai' = 'deepseek';
	let isLoading = false;
	let isContextOpen = false;
	let isSettingsOpen = false;

	// ─── LOCAL UI STATE FOR CONTEXT CHECKBOXES (Unchanged) ──────────────────────────────────────
	let ctxUiHierarchy = false;
	let ctxSelectedElem = true;
	let ctxPyConsoleOut = false;
	let ctxPyConsoleLines: 'lastError' | '5' | '10' | 'all' = '5';
	let ctxPyCode = false;
	let ctxDeviceInfo = false;

	// ─── DERIVED STORES FOR REACTIVE STATE (Unchanged) ───────────────────────────────────────────
	const lastErrorTraceback = derived(pythonConsoleStore, ($store) => $store.lastError);
	const hasLastError = derived(lastErrorTraceback, ($traceback) => $traceback != null);
	let includeLastError = false;

	// ─── RAG STATUS (Unchanged) ──────────────────────────────────────────────────────────────────
	let ragStatusText = 'RAG Status';
	let ragStatusClass = '';

	// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────────────────────
	function scrollToBottom() {
		const el = document.getElementById('chat-history');
		if (el) el.scrollTop = el.scrollHeight;
	}

	// ✅ STEP 3: UPDATE FUNCTIONS TO USE THE SHARED STORE
	function addMessage(raw: string, role: 'user' | 'assistant') {
		// This now updates the central `chatMessages` store.
		chatMessages.update((ms) => [...ms, { role, raw }]);
		scrollToBottom();
	}

	function clearChat() {
		// This now resets the central `chatMessages` store to its initial state.
		chatMessages.set([
			{
				role: 'assistant',
				raw: 'Hello! How can I assist you with your UI automation tasks today?'
			}
		]);
		includeLastError = false;
	}

	// ─── CORE LOGIC: GATHER CONTEXT (Unchanged) ───────────────────────────────────────────────────
	function gatherContext() {
		const ctx: any = {};
		if (ctxUiHierarchy && $hierarchy) {
			ctx.uiHierarchy = $hierarchy;
		}
		if (ctxSelectedElem) {
			const selectedElements =
				$multiSelectedNodes.length > 0
					? $multiSelectedNodes
					: $selectedNode
					? [$selectedNode]
					: [];
			if (selectedElements.length > 0) {
				ctx.selectedElements = selectedElements;
			}
		}
		if (includeLastError && $lastErrorTraceback) {
			ctx.pythonLastErrorTraceback = $lastErrorTraceback;
		}
		const consoleState = get(pythonConsoleStore);
		if (ctxPyConsoleOut && consoleState.output.length > 0) {
			const out = consoleState.output.join('\n');
			if (ctxPyConsoleLines === 'all') {
				ctx.pythonConsoleOutput = out;
			} else if (ctxPyConsoleLines === 'lastError' && consoleState.lastError) {
				ctx.pythonConsoleOutput = consoleState.lastError;
			} else {
				const n = parseInt(ctxPyConsoleLines);
				ctx.pythonConsoleOutput = consoleState.output.slice(-n).join('\n');
			}
		}
		if (ctxPyCode && consoleState.code) {
			ctx.pythonCode = consoleState.code;
		}
		if (ctxDeviceInfo && $selectedSerial) {
			const currentDevice = $devices.find((d) => d.serial === $selectedSerial);
			if (currentDevice) {
				ctx.deviceInfo = {
					serial: currentDevice.serial,
					model: currentDevice.model,
					sdkVersion: currentDevice.sdkVersion
				};
			}
		}
		return ctx;
	}

	// ─── CORE LOGIC: SEND PROMPT ──────────────────────────────────────────────────────────────────
	async function sendPrompt() {
		const userInput = promptText.trim();
		if (!userInput || isLoading) return;

		isLoading = true;
		addMessage(userInput, 'user');
		promptText = '';
		addMessage('...', 'assistant');

		const payload = {
			prompt: userInput,
			context: gatherContext(),
			// ✅ STEP 3 (cont.): Read history from the shared store.
			history: get(chatMessages)
				.slice(0, -2)
				.map((m) => ({ role: m.role, content: m.raw })),
			provider: model
		};

		if (includeLastError) {
			includeLastError = false;
		}

		try {
			await sendChatMessage(payload, (chunk) => {
				// ✅ STEP 3 (cont.): Update the shared store with the streaming response.
				const currentMessages = get(chatMessages);
				if (currentMessages[currentMessages.length - 1].raw === '...') {
					chatMessages.update((ms) => {
						ms[ms.length - 1].raw = chunk;
						return ms;
					});
				} else {
					chatMessages.update((ms) => {
						ms[ms.length - 1].raw += chunk;
						return ms;
					});
				}
				scrollToBottom();
			});
		} catch (err: any) {
			// ✅ STEP 3 (cont.): Update the shared store on error.
			chatMessages.update((ms) => {
				ms[ms.length - 1].raw = `Sorry, an error occurred: ${err.message}`;
				return ms;
			});
		} finally {
			isLoading = false;
		}
	}

	// ─── CORE LOGIC: TOGGLE ERROR (Unchanged) ───────────────────────────────────────────────────
	function toggleError() {
		if (!get(hasLastError)) {
			return;
		}
		includeLastError = !includeLastError;
	}

	// ─── ONMOUNT LIFECYCLE (Unchanged) ──────────────────────────────────────────────────────────
	onMount(() => {
		// clearChat(); // We might not want to clear the chat every time the component mounts
		const poll = async () => {
			try {
				const cfg = await fetch('/api/config/services').then((r) => r.json());
				if (!cfg.ragApiBaseUrl) {
					throw new Error('RAG API URL not configured.');
				}
				const url = cfg.ragApiBaseUrl.replace(/\/$/, '') + '/health';
				const h = await fetch(url).then((r) => r.json());
				ragStatusText = h.status === 'ok' ? 'RAG Online' : 'RAG Degraded';
				ragStatusClass =
					h.status === 'ok'
						? 'status-ok'
						: h.status === 'degraded'
						? 'status-degraded'
						: 'status-error';
			} catch {
				ragStatusText = 'RAG Error';
				ragStatusClass = 'status-error';
			}
		};
		poll();
		const id = setInterval(poll, 15000);
		return () => clearInterval(id);
	});
</script>

<div class="llm-chat-main">
	<div id="chat-history">
		{#each $chatMessages as msg, i (i)}
			<div class="llm-message {msg.role}">
				<ChatMessage rawContent={msg.raw} />
			</div>
		{/each}
	</div>

	<div class="prompt-area">
		<div class="actions-toolbar">
			<div class="toolbar-group">
				<button
					class="icon-btn"
					on:click={() => (isContextOpen = !isContextOpen)}
					class:active={isContextOpen}
					title="Attach Context">📎</button
				>
				<button
					class="icon-btn"
					on:click={toggleError}
					class:active={includeLastError}
					disabled={!$hasLastError}
					title={includeLastError ? 'Error Included' : 'Include Last Error'}
					>❗</button
				>
			</div>

			<div class="toolbar-group">
				<div class="rag-status-indicator {ragStatusClass}" title={ragStatusText}></div>
				<button
					class="icon-btn"
					on:click={() => (isSettingsOpen = !isSettingsOpen)}
					class:active={isSettingsOpen}
					title="Settings">⚙️</button
				>
			</div>

			{#if isContextOpen}
				<div class="popover-panel context-panel">
					<label><input type="checkbox" bind:checked={ctxUiHierarchy} /> UI Hierarchy</label>
					<label><input type="checkbox" bind:checked={ctxSelectedElem} /> Selected Element</label>
					<label><input type="checkbox" bind:checked={ctxPyCode} /> Python Code</label>
					<label><input type="checkbox" bind:checked={ctxDeviceInfo} /> Device Info</label>
					<label>
						<input type="checkbox" bind:checked={ctxPyConsoleOut} />
						<span>
							Console Output
							<select bind:value={ctxPyConsoleLines} disabled={!ctxPyConsoleOut}>
								<option value="lastError">Last Error</option>
								<option value="5">Last 5 lines</option>
								<option value="10">Last 10 lines</option>
								<option value="all">All</option>
							</select>
						</span>
					</label>
				</div>
			{/if}

			{#if isSettingsOpen}
				<div class="popover-panel settings-panel">
					<label for="model-select">Model:</label>
					<select id="model-select" bind:value={model}>
						<option value="deepseek">DeepSeek</option>
						<option value="openai">OpenAI</option>
					</select>
					<button on:click={clearChat}>Clear Chat</button>
				</div>
			{/if}
		</div>

		<div class="prompt-input-wrapper">
			<textarea
				class="prompt-input"
				placeholder="Type your message, or ask about an element..."
				bind:value={promptText}
				on:keypress={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						sendPrompt();
					}
				}}
				disabled={isLoading}
			></textarea>
			<button class="send-btn" on:click={sendPrompt} disabled={isLoading || !promptText.trim()}
				>➤</button
			>
		</div>
	</div>
</div>

<style>
	/* All styles are unchanged */
	.llm-chat-main {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--dark-bg-primary, #1e1e1e);
	}

	#chat-history {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.llm-message {
		max-width: 90%;
		word-break: break-word;
		font-size: 13px;
		line-height: 1.45;
	}
	.llm-message.user {
		align-self: flex-end;
		background: var(--dark-accent-primary, #007acc);
		color: white;
		padding: 6px 10px;
		border-radius: 6px;
		border-bottom-right-radius: 2px;
	}
	.llm-message.assistant {
		align-self: flex-start;
		background: var(--dark-bg-secondary, #2d2d2d);
		color: var(--dark-text-primary, #d4d4d4);
		padding: 6px 10px;
		border-radius: 6px;
		border-bottom-left-radius: 2px;
	}

	:global(.llm-message.assistant p:first-child) {
		margin-top: 0;
	}
	:global(.llm-message.assistant p:last-child) {
		margin-bottom: 0;
	}
	:global(.llm-message.assistant pre) {
		background-color: #1a1a1a;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.6rem;
		margin: 0.5rem 0;
		overflow-x: auto;
		font-size: 13px;
		position: relative;
	}
	:global(.code-actions) {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.2s;
	}
	:global(pre:hover .code-actions) {
		opacity: 1;
	}
	:global(.code-actions button) {
		background-color: #4f4f4f;
		color: #eee;
		border: 1px solid #666;
		border-radius: 4px;
		padding: 2px 8px;
		font-size: 11px;
		cursor: pointer;
	}

	.prompt-area {
		padding: 0.5rem;
		border-top: 1px solid #333;
		background: var(--dark-bg-secondary, #252526);
		flex-shrink: 0;
	}

	.actions-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
		position: relative;
	}
	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.icon-btn {
		background: transparent;
		border: none;
		color: #9e9e9e;
		padding: 4px;
		border-radius: 5px;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}
	.icon-btn:hover {
		background-color: #4f4f4f;
		color: #fff;
	}
	.icon-btn.active {
		background-color: #007acc;
		color: white;
	}
	.icon-btn:disabled {
		color: #555;
		cursor: not-allowed;
	}
	.icon-btn:disabled:hover {
		background-color: transparent;
	}

	.popover-panel {
		position: absolute;
		bottom: 100%;
		margin-bottom: 5px;
		background: #3c3c3c;
		border: 1px solid #555;
		border-radius: 6px;
		padding: 0.75rem;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	.context-panel {
		left: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(150px, 1fr));
		gap: 0.6rem;
	}
	.settings-panel {
		right: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.popover-panel label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 13px;
	}
	.popover-panel input[type='checkbox'] {
		cursor: pointer;
	}

	.settings-panel select {
		width: 100%;
		background: #2a2a2a;
		border: 1px solid #555;
		color: #ddd;
		padding: 4px;
		border-radius: 4px;
	}
	.settings-panel button {
		width: 100%;
		background: #8c3a3a;
		color: white;
		border: none;
		padding: 6px;
		border-radius: 4px;
		cursor: pointer;
	}

	.rag-status-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.rag-status-indicator.status-ok {
		background-color: #4caf50;
	}
	.rag-status-indicator.status-degraded {
		background-color: #ff9800;
	}
	.rag-status-indicator.status-error {
		background-color: #f44336;
	}

	.prompt-input-wrapper {
		display: flex;
		align-items: flex-end;
		background: #3c3c3c;
		border: 1px solid #555;
		border-radius: 6px;
		padding: 2px 2px 2px 8px;
	}
	.prompt-input-wrapper:focus-within {
		border-color: #007acc;
	}
	.prompt-input {
		flex-grow: 1;
		padding: 6px 4px;
		background: transparent;
		border: none;
		color: #e0e0e0;
		font-family: inherit;
		font-size: 13px;
		resize: none;
		line-height: 1.5;
		max-height: 150px;
		overflow-y: auto;
	}
	.prompt-input:focus {
		outline: none;
	}

	.send-btn {
		margin-left: 4px;
		background: #007acc;
		border: none;
		color: white;
		width: 32px;
		height: 32px;
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
	}
	.send-btn:disabled {
		background: #555;
		cursor: not-allowed;
	}
</style>
