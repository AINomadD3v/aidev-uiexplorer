<script lang="ts">
	import { tick } from 'svelte';
	import { derived, get } from 'svelte/store';

	// ✅ 1. Import all necessary stores and functions
	import { screenshotStore, refreshScreenshot, screenshotRefreshTrigger } from '$lib/stores/screenshot';
	import { hierarchy, refreshHierarchy } from '$lib/stores/hierarchy'; // This is the key to the fix
	import {
		selectedSerial,
		selectedNode,
		hoveredNode,
		multiSelectMode,
		multiSelectedNodes,
		type NodeInfo
	} from '$lib/stores/uiagent';

	// --- Local state & element bindings ---
	let imgEl: HTMLImageElement;
	let containerEl: HTMLDivElement;
	let isRefreshing = false;

	let tooltip = {
		visible: false,
		x: 0,
		y: 0,
		content: ''
	};

	// ✅ 2. Use the imported trigger store for reactivity
	$: screenshotUrl = $selectedSerial
		? `/api/android/${$selectedSerial}/screenshot/0?t=${$screenshotRefreshTrigger}`
		: '';

	// ✅ 3. The new, combined refresh handler
	async function handleRefresh() {
		if (isRefreshing || !$selectedSerial) return;
		isRefreshing = true;
		console.log('Refreshing hierarchy and screenshot...');

		try {
			// First, tell the hierarchy to refresh. We `await` this to ensure
			// the new locator data is fetched before we proceed.
			await refreshHierarchy();

			// Then, call the exported function to refresh the screenshot.
			refreshScreenshot();
		} catch (error) {
			console.error('Failed to refresh:', error);
		}
		// The loading state will be turned off when the image finishes loading.
	}

	async function measureImage() {
		await tick();
		if (!imgEl) return;
		screenshotStore.update((current) => ({
			...current,
			renderedWidth: imgEl.width,
			renderedHeight: imgEl.height,
			naturalWidth: imgEl.naturalWidth,
			naturalHeight: imgEl.naturalHeight
		}));
		isRefreshing = false; // Stop the loading spinner
	}

	const scaledNodes = derived([hierarchy, screenshotStore], ([$hierarchy, $screenshot]) => {
		const allNodes: (NodeInfo & { pxRect: { x: number; y: number; w: number; h: number } })[] =
			[];
		if (!$hierarchy || $screenshot.renderedWidth === 0) {
			return allNodes;
		}

		function recurse(node: NodeInfo) {
			if (node.bounds?.length === 4) {
				const [x1, y1, x2, y2] = node.bounds;
				const scaledRect = {
					x: x1 * $screenshot.renderedWidth,
					y: y1 * $screenshot.renderedHeight,
					w: (x2 - x1) * $screenshot.renderedWidth,
					h: (y2 - y1) * $screenshot.renderedHeight
				};
				if (scaledRect.w > 0 && scaledRect.h > 0) {
					allNodes.push({ ...node, pxRect: scaledRect });
				}
			}
			node.children?.forEach(recurse);
		}
		recurse($hierarchy);
		return allNodes;
	});

	function findBestElement(candidates: NodeInfo[]): NodeInfo | null {
		if (candidates.length === 0) return null;
		if (candidates.length === 1) return candidates[0];
		return candidates.sort((a, b) => {
			const aClickable = a.properties?.clickable === true || a.properties?.clickable === 'true';
			const bClickable = b.properties?.clickable === true || b.properties?.clickable === 'true';
			if (aClickable && !bClickable) return -1;
			if (!aClickable && bClickable) return 1;
			const areaA = (a.bounds![2] - a.bounds![0]) * (a.bounds![3] - a.bounds![1]);
			const areaB = (b.bounds![2] - b.bounds![0]) * (b.bounds![3] - b.bounds![1]);
			return areaA - areaB;
		})[0];
	}

	function getNodeAt(evt: MouseEvent): NodeInfo | null {
		if (!$hierarchy || !imgEl) return null;
		const imgRect = imgEl.getBoundingClientRect();
		const x = evt.clientX - imgRect.left;
		const y = evt.clientY - imgRect.top;
		if (x < 0 || y < 0 || x > imgRect.width || y > imgRect.height) return null;
		const relX = x / imgRect.width;
		const relY = y / imgRect.height;
		const candidates: NodeInfo[] = [];
		for (const node of $scaledNodes) {
			const [x1, y1, x2, y2] = node.bounds!;
			if (relX >= x1 && relX <= x2 && relY >= y1 && relY <= y2) {
				candidates.push(node);
			}
		}
		return findBestElement(candidates);
	}

	function onMouseMove(evt: MouseEvent) {
		const node = getNodeAt(evt);
		hoveredNode.set(node);
		if (node) {
			let content = `<b>${node.name}</b>`;
			const text = node.properties?.text;
			const desc = node.properties?.['content-desc'];
			const resId = node.properties?.['resource-id'];
			if (resId) content += `<br><small>ID:</small> ${resId}`;
			if (text) content += `<br><small>Text:</small> ${text}`;
			if (desc) content += `<br><small>Desc:</small> ${desc}`;
			tooltip = { visible: true, x: evt.clientX + 15, y: evt.clientY + 15, content };
		} else {
			tooltip.visible = false;
		}
	}

	function onMouseLeave() {
		hoveredNode.set(null);
		tooltip.visible = false;
	}

	function onClick(evt: MouseEvent) {
		const clickedNode = getNodeAt(evt);
		multiSelectMode.set(evt.ctrlKey || evt.metaKey);
		if (!clickedNode) {
			if (!$multiSelectMode) {
				selectedNode.set(null);
				multiSelectedNodes.set([]);
			}
			return;
		}
		if ($multiSelectMode) {
			const list = get(multiSelectedNodes);
			const idx = list.findIndex((n) => n.key === clickedNode.key);
			if (idx >= 0) {
				list.splice(idx, 1);
			} else {
				list.push(clickedNode);
			}
			multiSelectedNodes.set(list);
			selectedNode.set(list.at(-1) || null);
		} else {
			multiSelectedNodes.set([]);
			selectedNode.set(clickedNode);
		}
	}

	function onKeyDown(evt: KeyboardEvent) {
		if (evt.key === 'r' && (evt.metaKey || evt.ctrlKey)) {
			evt.preventDefault();
			handleRefresh();
		}
		if (evt.key === 'Enter' || evt.key === ' ') {
			const hovered = get(hoveredNode);
			if (hovered && hovered.bounds) {
				const mockEvent = {
					ctrlKey: evt.ctrlKey,
					metaKey: evt.metaKey
				} as MouseEvent;
				onClick(mockEvent);
			}
		}
	}
</script>

<style>
	.container {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		cursor: crosshair;
	}
    /* ✅ NEW: This wrapper will contain the image and overlay, ensuring they are aligned. */
	.image-wrapper {
		position: relative;
        /* This prevents extra space from being added below the image element */
		line-height: 0;
	}
	img {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.overlay {
		position: absolute;
		top: 0;
		left: 0;
        /* The width and height will be set dynamically via component state */
		pointer-events: none;
	}
	.overlay rect {
		stroke: rgba(150, 150, 150, 0.4);
		stroke-width: 1px;
		fill: transparent;
		transition: all 0.1s ease-out;
		pointer-events: all;
	}
	.overlay rect.hovered {
		stroke: rgba(0, 255, 120, 0.9);
		stroke-width: 2px;
		fill: transparent;
	}
	.overlay rect.multi-selected {
		stroke: rgba(255, 165, 0, 0.9);
		stroke-width: 2px;
		fill: rgba(255, 165, 0, 0.2);
	}
	.overlay rect.selected {
		stroke: rgba(0, 120, 255, 0.95);
		stroke-width: 2px;
		fill: rgba(0, 120, 255, 0.25);
	}
	.placeholder {
		color: #666;
		text-align: center;
	}
	.tooltip {
		position: fixed;
		background-color: rgba(30, 30, 30, 0.95);
		color: #f0f0f0;
		border: 1px solid #666;
		border-radius: 6px;
		padding: 10px 14px;
		font-size: 13px;
		font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
		pointer-events: none;
		z-index: 1000;
		max-width: 450px;
		line-height: 1.6;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		word-break: break-all;
	}
	:global(.tooltip b) {
		color: #92c9ff;
		font-weight: bold;
	}
	:global(.tooltip small) {
		color: #999;
	}
	.refresh-button {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 10;
		background: rgba(30, 30, 30, 0.6);
		border: 1px solid #888;
		color: #fff;
		border-radius: 50%;
		width: 36px;
		height: 36px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		line-height: 1;
		backdrop-filter: blur(2px);
		transition: all 0.2s ease-out;
	}
	.refresh-button:hover {
		background: rgba(0, 120, 255, 0.7);
		transform: rotate(120deg);
	}
	.refresh-button.loading {
		cursor: not-allowed;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>

<div
	bind:this={containerEl}
	class="container"
	role="application"
	tabindex="0"
	aria-label="Interactive Device Screenshot"
	on:mousemove={onMouseMove}
	on:mouseleave={onMouseLeave}
	on:click={onClick}
	on:keydown={onKeyDown}
>
	{#if !$selectedSerial}
		<div class="placeholder">No device selected</div>
	{:else}
        <!-- ✅ NEW WRAPPER DIV -->
		<div class="image-wrapper">
			<button
				class="refresh-button"
				class:loading={isRefreshing}
				on:click={handleRefresh}
				disabled={isRefreshing}
				title="Refresh Screenshot & Hierarchy (Ctrl+R)"
			>
				&#x21bb;
			</button>

			<img
				bind:this={imgEl}
				src={screenshotUrl}
				alt="Device screenshot"
				on:load={measureImage}
				on:error={() => {
					console.error('Failed to load screenshot for', screenshotUrl);
					isRefreshing = false;
				}}
			/>

			<svg
				class="overlay"
				width={$screenshotStore.renderedWidth}
				height={$screenshotStore.renderedHeight}
				viewBox="0 0 {$screenshotStore.renderedWidth} {$screenshotStore.renderedHeight}"
			>
				{#each $scaledNodes as node (node.key)}
					<rect
						x={node.pxRect.x}
						y={node.pxRect.y}
						width={node.pxRect.w}
						height={node.pxRect.h}
						class:selected={$selectedNode?.key === node.key}
						class:hovered={$hoveredNode?.key === node.key && $selectedNode?.key !== node.key}
						class:multi-selected={$multiSelectMode &&
							$multiSelectedNodes.some((n) => n.key === node.key)}
					/>
				{/each}
			</svg>
		</div>
	{/if}

	{#if tooltip.visible}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;" role="tooltip">
			{@html tooltip.content}
		</div>
	{/if}
</div>

