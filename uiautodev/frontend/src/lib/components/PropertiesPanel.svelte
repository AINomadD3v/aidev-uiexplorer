<script lang="ts">
	import type { NodeInfo } from '$lib/stores/uiagent';

	export let selectedNode: NodeInfo | null;
	export let generatedXPath: string;

	let copyButtonText = 'Copy';

	/**
	 * Copies the generated XPath to the clipboard.
	 */
	function copyXPath() {
		if (!generatedXPath) return;
		navigator.clipboard.writeText(generatedXPath).then(() => {
			copyButtonText = 'Copied!';
			setTimeout(() => {
				copyButtonText = 'Copy';
			}, 2000);
		});
	}
</script>

<style>
	.wrapper {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.5rem; /* Space between properties and XPath */
	}

	.properties-grid {
		display: grid;
		grid-template-columns: max-content 1fr; /* Key column sized to content, value takes rest */
		gap: 0.6rem 1rem; /* Vertical and horizontal gap */
		font-size: 13px;
		line-height: 1.4;
	}

	.prop-key {
		color: #888;
		font-weight: 500;
		text-align: right;
		user-select: none;
	}

	.prop-value {
		color: #ddd;
		word-break: break-all; /* Break long values like resource-ids */
		background-color: #2a2a2a;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'Courier New', Courier, monospace;
	}

	.xpath-section {
		margin-top: auto; /* Pushes this section to the bottom */
		padding-top: 1rem;
		border-top: 1px solid #333;
	}

	.xpath-title {
		font-size: 0.9rem;
		font-weight: bold;
		color: #aaa;
		margin-bottom: 0.5rem;
	}

	.xpath-box {
		display: flex;
		align-items: center;
		background: #2a2a2a;
		border-radius: 4px;
		border: 1px solid #3c3c3c;
	}

	.xpath-text {
		padding: 0.5rem;
		color: #00c8ff; /* Make XPath stand out */
		font-family: 'Courier New', Courier, monospace;
		font-size: 13px;
		white-space: nowrap;
		overflow-x: auto;
		flex-grow: 1;
	}

	.copy-btn {
		background: #3c3c3c;
		border: none;
		color: #eee;
		padding: 0.5rem 1rem;
		cursor: pointer;
		border-left: 1px solid #3c3c3c;
		transition: background-color 0.2s;
		flex-shrink: 0;
	}

	.copy-btn:hover {
		background-color: #4f4f4f;
	}

	.no-selection {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #666;
		font-style: italic;
		user-select: none;
	}
</style>

<div class="wrapper">
	{#if selectedNode}
		<div class="properties-grid">
			{#each Object.entries(selectedNode.properties) as [key, value]}
				<div class="prop-key">{key}</div>
				<div class="prop-value">{value === '' ? '""' : value}</div>
			{/each}
		</div>

		<div class="xpath-section">
			<div class="xpath-title">Generated XPath</div>
			<div class="xpath-box">
				<div class="xpath-text">{generatedXPath}</div>
				<button class="copy-btn" on:click={copyXPath}>{copyButtonText}</button>
			</div>
		</div>
	{:else}
		<div class="no-selection">
			<p>Select an element from the screenshot or hierarchy to see details.</p>
		</div>
	{/if}
</div>
