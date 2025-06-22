<script lang="ts">
	import { selectedNode, hoveredNode } from '$lib/stores/uiagent';
	import type { NodeInfo } from '$lib/stores/uiagent';

	export let node: NodeInfo;
	export let expanded: Set<string>;
	export let searchTerm: string;
	export let currentMatchKey: string | null = null; // New prop for active match

	$: isMatch = checkMatch(node, searchTerm);
	$: hasProperties = node.properties?.text || node.properties?.['resource-id'];

	function checkMatch(n: NodeInfo, term: string): boolean {
		if (!term) return false;
		const lowerCaseTerm = term.toLowerCase();
		if (n.name.toLowerCase().includes(lowerCaseTerm)) return true;
		if (n.properties) {
			for (const key in n.properties) {
				const value = String(n.properties[key] ?? '').toLowerCase();
				if (value.includes(lowerCaseTerm)) return true;
			}
		}
		return false;
	}

	function toggle() {
		expanded.has(node.key) ? expanded.delete(node.key) : expanded.add(node.key);
		expanded = expanded;
	}

	function select() {
		selectedNode.set(node);
	}

	function highlight(text: string): string {
		if (!searchTerm || !isMatch) return text;
		const escapedTerm = searchTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
		const regex = new RegExp(`(${escapedTerm})`, 'gi');
		return text.replace(regex, '<mark>$1</mark>');
	}
</script>

<style>
	/* --- Tree Structure & Indentation Guides --- */
	ul {
		list-style: none;
		margin: 0;
		padding-left: 18px; /* Indentation for nested levels */
		position: relative;
	}

	/* The main vertical line connecting all items in a list. Made subtler. */
	ul::before {
		content: '';
		position: absolute;
		left: 6px; /* Aligns with the center of the toggle button */
		top: 0;
		bottom: 0;
		width: 1px;
		background-color: #3a3a3a;
	}

	li {
		position: relative;
	}

	/* The horizontal "elbow" connecting the item to the vertical line */
	li::before {
		content: '';
		position: absolute;
		left: 7px;
		top: 12px; /* Adjusted to align with new smaller font size */
		width: 11px;
		height: 1px;
		background-color: #3a3a3a;
	}

	/* "Erase" the vertical line for the last item in a list */
	li:last-child::after {
		content: '';
		position: absolute;
		left: 6px;
		top: 13px;
		bottom: 0;
		width: 1px;
		background-color: #1e1e1e; /* MUST MATCH the panel's background color */
	}

	/* --- Node Content Styling (REDESIGNED) --- */
	.node-content {
		border-radius: 4px;
		padding: 1px 0 1px 4px;
		margin-right: 4px;
		position: relative;
		overflow: hidden; /* For the selection bar */
		transition: background-color 0.1s ease-in-out;
	}
	.node-content:hover {
		background-color: #2a2a2d;
	}

	/* --- MODERN SELECTION INDICATOR --- */
	.node-content.selected {
		background-color: #264f78;
	}
	/* This is the blue vertical bar on the left of a selected item */
	.node-content.selected::before {
		content: '';
		position: absolute;
		left: -4px;
		top: 2px;
		bottom: 2px;
		width: 3px;
		background-color: #007acc;
		border-radius: 2px;
	}

	/* --- ACTIVE SEARCH MATCH HIGHLIGHT --- */
	.node-content.current-match {
		outline: 1px solid #ffcc00; /* A bright, noticeable color */
		outline-offset: -1px; /* Draw the outline just inside the element */
	}
	
	.node-content.current-match.selected {
		/* Keep the selection background even when it's the current match */
		background-color: #264f78;
	}

	.node-row {
		display: flex;
		align-items: center;
		gap: 0.15rem; /* Tighter gap */
	}

	.toggle {
		flex-shrink: 0;
		width: 1rem;
		text-align: center;
		cursor: pointer;
		color: #9e9e9e;
		user-select: none;
		font-size: 10px; /* Make toggle smaller */
	}
	.toggle:hover {
		color: #fff;
	}

	/* Main element label - font size reduced */
	.label {
		cursor: pointer;
		padding: 2px 4px;
		white-space: nowrap;
		font-size: 13px;
		color: #cccccc;
	}
	.selected .label {
		color: #fff;
	}

	/* Properties row - font size reduced */
	.properties-row {
		font-size: 11px;
		padding-left: 1.6rem; /* Indent properties under the parent name */
		color: #888;
		white-space: nowrap;
		padding-top: 1px;
	}
	.selected .properties-row {
		color: #a0cff1; /* Lighter color when selected */
	}

	.prop-key {
		color: #6e6e6e;
	}
	.selected .prop-key {
		color: #83b6dd;
	}

	:global(mark) {
		background-color: #ff0;
		color: #000;
		padding: 0;
		border-radius: 2px;
	}
</style>

<li>
	<div
		id="hierarchy-node-{node.key}"
		class="node-content"
		class:selected={$selectedNode?.key === node.key}
		class:current-match={node.key === currentMatchKey}
		on:mouseenter={() => hoveredNode.set(node)}
		on:mouseleave={() => hoveredNode.set(null)}
		on:click|stopPropagation={select}
		title={JSON.stringify(node.properties, null, 2)}
	>
		<div class="node-row">
			{#if node.children.length}
				<span class="toggle" on:click|stopPropagation={toggle}>
					{expanded.has(node.key) ? '▼' : '▶'}
				</span>
			{:else}
				<span class="toggle" />
			{/if}

			<span class="label">
				{@html highlight(node.name)}
			</span>
		</div>

		{#if hasProperties}
			<div class="properties-row">
				{#if node.properties?.text}
					<span class="prop-key">text:</span> "{@html highlight(node.properties.text)}"
				{/if}
				{#if node.properties?.['resource-id']}
					<span class="prop-key" style="margin-left: 0.5rem">id:</span>
					{@html highlight(node.properties['resource-id'].split('/').pop() ?? '')}
				{/if}
			</div>
		{/if}
	</div>

	{#if expanded.has(node.key) && node.children.length}
		<ul>
			{#each node.children as child (child.key)}
				<svelte:self node={child} bind:expanded {searchTerm} {currentMatchKey} />
			{/each}
		</ul>
	{/if}
</li>
