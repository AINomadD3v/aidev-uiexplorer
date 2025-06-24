<script lang="ts">
	import { onMount } from 'svelte';
	import { get, derived } from 'svelte/store';
	import ChatMessage from '$lib/components/ChatMessage.svelte';

	// ─── CENTRAL STORES ──────────────────────────────────────────────────────────────────────────
	import { selectedSerial, selectedNode, devices, multiSelectedNodes } from '$lib/stores/uiagent';
	import { hierarchy } from '$lib/stores/hierarchy';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';
	import { sendChatMessage } from '$lib/api/pythonClient';
	import {
		chatMessages,
		type ChatMessage as ChatMessageType,
		type ToolCodeEdit
	} from '$lib/stores/assistant';

	// ─── LOCAL COMPONENT STATE ──────────────────────────────────────────────────────────────────
	let promptText = '';
	let model: 'deepseek' | 'openai' = 'deepseek';
	let isLoading = false;
	let isContextOpen = false;
	let isSettingsOpen = false;

	// ─── LOCAL UI STATE FOR CONTEXT CHECKBOXES ──────────────────────────────────────────────────
	let ctxUiHierarchy = false;
	let ctxSelectedElem = true;
	let ctxPyConsoleOut = false;
	let ctxPyConsoleLines: 'lastError' | '5' | '10' | 'all' = '5';
	let ctxDeviceInfo = false;

	// ─── DERIVED STORES ─────────────────────────────────────────────────────────────────────────
	const lastErrorTraceback = derived(pythonConsoleStore, ($store) => $store.lastError);
	const hasLastError = derived(lastErrorTraceback, ($traceback) => $traceback != null);
	let includeLastError = false;

	// ─── RAG STATUS ─────────────────────────────────────────────────────────────────────────────
	let ragStatusText = 'RAG Status';
	let ragStatusClass = '';

	// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────────────────────
	function scrollToBottom() {
		requestAnimationFrame(() => {
			const el = document.getElementById('chat-history');
			if (el) el.scrollTop = el.scrollHeight;
		});
	}

	function createMessage(
		role: 'user' | 'assistant',
		content: string,
		type: 'message' | 'tool_code_edit' = 'message'
	): ChatMessageType {
		return { role, type, content, toolPayload: undefined, codeSnapshot: undefined };
	}

	function clearChat() {
		chatMessages.set([
			createMessage(
				'assistant',
				'Hello! How can I assist you with your UI automation tasks today?'
			)
		]);
		includeLastError = false;
	}

	function extractToolCall(text: string): { toolCall: ToolCodeEdit; precedingText: string } | null {
		const jsonStartIndex = text.indexOf('{');
		if (jsonStartIndex === -1) {
			return null;
		}

		let braceCount = 0;
		let jsonEndIndex = -1;
		let inString = false;
		let isEscaped = false;

		for (let i = jsonStartIndex; i < text.length; i++) {
			const char = text[i];
			if (char === '"' && !isEscaped) inString = !inString;
			if (!inString) {
				if (char === '{') braceCount++;
				if (char === '}') braceCount--;
			}
			isEscaped = char === '\\' && !isEscaped;
			if (braceCount === 0) {
				jsonEndIndex = i;
				break;
			}
		}

		if (jsonEndIndex !== -1) {
			const precedingText = text.substring(0, jsonStartIndex).trim();
			const potentialJson = text.substring(jsonStartIndex, jsonEndIndex + 1);
			try {
				const parsed = JSON.parse(potentialJson);
				if (parsed.tool_name === 'propose_edit') {
					return { toolCall: parsed, precedingText };
				}
			} catch (e) {
				// Not valid JSON
			}
		}
		return null;
	}

	function gatherContext(): any {
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

		if (consoleState.code) {
			ctx.pythonCode = consoleState.code;
		}

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

	async function sendPrompt() {
		const userInput = promptText.trim();
		if (!userInput || isLoading) return;

		isLoading = true;
		chatMessages.update((ms) => [...ms, createMessage('user', userInput)]);
		promptText = '';

		const contextForLLM = gatherContext();
		const codeSnapshot = contextForLLM.pythonCode;

		chatMessages.update((ms) => [...ms, createMessage('assistant', '...', 'message')]);

		const payload = {
			prompt: userInput,
			context: contextForLLM,
			history: get(chatMessages)
				.slice(0, -2)
				.map((m) => ({ role: m.role, content: m.content })),
			provider: model
		};

		if (includeLastError) {
			includeLastError = false;
		}

		try {
			let accumulatedResponse = '';
			await sendChatMessage(payload, (token) => {
				accumulatedResponse += token;
				chatMessages.update((ms) => {
					const lastMessage = ms[ms.length - 1];
					if (lastMessage && lastMessage.content.startsWith('...')) {
						lastMessage.content = accumulatedResponse;
					}
					return [...ms];
				});
				scrollToBottom();
			});

			chatMessages.update((ms) => {
				const lastMessage = ms[ms.length - 1];
				if (!lastMessage) return ms;

				const parsedResult = extractToolCall(accumulatedResponse);
				if (parsedResult) {
					lastMessage.type = 'tool_code_edit';
					lastMessage.content =
						parsedResult.precedingText || parsedResult.toolCall.explanation || 'Code edit proposed.';
					lastMessage.toolPayload = parsedResult.toolCall;
					lastMessage.codeSnapshot = codeSnapshot;
				} else {
					lastMessage.type = 'message';
					lastMessage.content = accumulatedResponse;
				}
				return [...ms];
			});
		} catch (err: any) {
			chatMessages.update((ms) => {
				const lastMessage = ms[ms.length - 1];
				if (lastMessage) lastMessage.content = `Sorry, an error occurred: ${err.message}`;
				return [...ms];
			});
		} finally {
			isLoading = false;
			scrollToBottom();
		}
	}

	function toggleError() {
		if (!get(hasLastError)) return;
		includeLastError = !includeLastError;
	}

	onMount(() => {
		setTimeout(() => {
			chatMessages.update((messages) => [...messages]);
			scrollToBottom();
		}, 0);

		const poll = async () => {
			try {
				const cfg = await fetch('/api/config/services').then((r) => r.json());
				if (!cfg.ragApiBaseUrl) throw new Error('RAG API URL not configured.');
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
				<ChatMessage message={msg} />
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
		width: fit-content;
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
		grid-template-columns: repeat(2, minmax(140px, 1fr));
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

