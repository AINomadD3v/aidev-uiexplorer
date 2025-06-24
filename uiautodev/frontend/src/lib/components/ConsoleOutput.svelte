<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole';

	// --- Component State ---
	let lines: string[] = [];
	let panelEl: HTMLDivElement;

	// --- Position and Size State ---
	let position = { x: window.innerWidth - 650, y: window.innerHeight - 400 };
	let size = { w: 600, h: 300 };

	// --- Dragging State ---
	let isDragging = false;
	let dragStart = { x: 0, y: 0 };

	// --- Resizing State ---
	let isResizing = false;
	let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

	onMount(() => {
		const unsubscribe = pythonConsoleStore.subscribe(($s) => {
			lines = $s.output;
		});

		// --- Event Handlers ---
		const handleMouseMove = (e: MouseEvent) => {
			if (isDragging) {
				const dx = e.clientX - dragStart.x;
				const dy = e.clientY - dragStart.y;
				position = { x: position.x + dx, y: position.y + dy };
				dragStart = { x: e.clientX, y: e.clientY };
			}
			if (isResizing) {
				const dw = e.clientX - resizeStart.x;
				const dh = e.clientY - resizeStart.y;
				size = {
					w: Math.max(300, resizeStart.w + dw),
					h: Math.max(150, resizeStart.h + dh)
				};
			}
		};

		const handleMouseUp = () => {
			isDragging = false;
			isResizing = false;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			unsubscribe();
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});

	// --- Drag and Resize Initiators ---
	function handleDragStart(e: MouseEvent) {
		isDragging = true;
		dragStart = { x: e.clientX, y: e.clientY };
		document.body.style.cursor = 'move';
		document.body.style.userSelect = 'none';
	}

	function handleResizeStart(e: MouseEvent) {
		isResizing = true;
		resizeStart = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
		document.body.style.cursor = 'nwse-resize';
		document.body.style.userSelect = 'none';
	}
</script>

<div
	class="floating-panel-container"
	bind:this={panelEl}
	style="left: {position.x}px; top: {position.y}px; width: {size.w}px; height: {size.h}px;"
>
	<!-- Header: Title, Drag Handle, Close Button -->
	<div class="panel-header" on:mousedown|self={handleDragStart}>
		<span class="panel-title">Console Output</span>
		<button class="close-btn" on:click={() => pythonConsoleStore.close()} title="Close">×</button>
	</div>

	<!-- Output Content -->
	<div class="output-content">
		{#if lines.length === 0}
			<div class="line placeholder"># No output yet. Run some code to see the results.</div>
		{:else}
			{#each lines as line}
				<div class="line">{line}</div>
			{/each}
		{/if}
	</div>

	<!-- Resize Handle -->
	<div class="resize-handle" on:mousedown|preventDefault={handleResizeStart}></div>
</div>

<style>
	.floating-panel-container {
		position: fixed;
		z-index: 1000;
		background: #252526;
		border: 1px solid #4a4a4a;
		border-radius: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: #d4d4d4;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 12px;
		background: #3c3c3c;
		cursor: move;
		user-select: none;
		border-bottom: 1px solid #4a4a4a;
	}

	.panel-title {
		font-weight: 600;
		font-size: 14px;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: #aaa;
		font-size: 20px;
		line-height: 1;
		padding: 0 4px;
		cursor: pointer;
		border-radius: 4px;
	}
	.close-btn:hover {
		background: #555;
		color: #fff;
	}

	.output-content {
		flex: 1;
		padding: 8px 12px;
		overflow-y: auto;
		font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
		font-size: 13px;
		background: #1e1e1e;
		scrollbar-width: thin;
		scrollbar-color: #555 #2a2a2a;
	}

	.line {
		white-space: pre-wrap;
		word-break: break-all;
		min-height: 1.2em;
	}
	.placeholder {
		color: #888;
		font-style: italic;
	}

	.resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 16px;
		height: 16px;
		cursor: nwse-resize;
		background: repeating-linear-gradient(
			-45deg,
			transparent,
			transparent 4px,
			#555 4px,
			#555 5px
		);
		opacity: 0.7;
	}
</style>

