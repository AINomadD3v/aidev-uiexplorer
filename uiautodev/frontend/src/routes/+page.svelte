<script lang="ts">
	// ─── Svelte Imports ──────────────────────────────────────────────────────────────────────────
	import { onMount, tick } from 'svelte';
	import { derived } from 'svelte/store';
	import type { NodeInfo } from '$lib/stores/uiagent';

	// ─── Stores ──────────────────────────────────────────────────────────────────────────────────
	import { selectedSerial, selectedNode } from '$lib/stores/uiagent';
	import { pythonConsoleStore } from '$lib/stores/pythonConsole'; // ✅ Import the console store
	import {
		hierarchy,
		isLoadingHierarchy,
		hierarchyError,
		refreshHierarchy
	} from '$lib/stores/hierarchy';

	// ─── Components ──────────────────────────────────────────────────────────────────────────────
	import DeviceSelectorPanel from '$lib/components/DeviceSelectorPanel.svelte';
	import DeviceScreenshot from '$lib/components/DeviceScreenshot.svelte';
	import LLMAssistant from '$lib/components/LLMAssistant.svelte';
	import PropertiesPanel from '$lib/components/PropertiesPanel.svelte';
	import PythonConsole from '$lib/components/PythonConsole.svelte';
	import HierarchyTree from '$lib/components/HierarchyTree.svelte';
	import ConsoleOutput from '$lib/components/ConsoleOutput.svelte'; // ✅ Import the new floating console

	// ─── Component State ─────────────────────────────────────────────────────────────────────────

	/** The active tab in the middle panel ('assistant' or 'details'). */
	let midTab: 'assistant' | 'details' = 'assistant';

	/** The active tab in the right panel ('python' or 'hierarchy'). */
	let rightTab: 'python' | 'hierarchy' = 'python';

	/** The search term entered by the user for filtering the UI hierarchy. */
	let hierarchySearchTerm = '';

	/** A Set containing the keys of all nodes that should be expanded in the tree. */
	let expandedKeys = new Set<string>();

	/** An array of node keys that match the current search term. */
	let searchMatches: string[] = [];

	/** The index of the currently highlighted search match. */
	let currentMatchIndex = -1;

	// ─── Logic ───────────────────────────────────────────────────────────────────────────────────

	/**
	 * A helper function to determine if a node matches a given search term.
	 */
	function isNodeMatching(n: NodeInfo, term: string): boolean {
		const lowerCaseTerm = term.toLowerCase();
		if (n.name.toLowerCase().includes(lowerCaseTerm)) return true;
		if (n.properties) {
			for (const key in n.properties) {
				if (String(n.properties[key] ?? '').toLowerCase().includes(lowerCaseTerm)) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Helper function to find a node by its key from the root.
	 */
	function findNodeByKey(node: NodeInfo, key: string): NodeInfo | null {
		if (node.key === key) return node;
		for (const child of node.children) {
			const found = findNodeByKey(child, key);
			if (found) return found;
		}
		return null;
	}

	/**
	 * Reactive block to automatically expand the hierarchy and find search matches.
	 */
	$: if ($hierarchy) {
		if (!hierarchySearchTerm) {
			// Clear search results and expand all nodes
			const allKeys = new Set<string>();
			const expandAll = (n: NodeInfo) => {
				allKeys.add(n.key);
				n.children?.forEach(expandAll);
			};
			expandAll($hierarchy);
			expandedKeys = allKeys;
			searchMatches = [];
			currentMatchIndex = -1;
		} else {
			const matchingParentKeys = new Set<string>();
			const directMatches: string[] = [];

			const searchAndExpand = (node: NodeInfo, path: string[]): boolean => {
				const currentPath = [...path, node.key];
				let hasMatchingDescendant = false;

				for (const child of node.children) {
					if (searchAndExpand(child, currentPath)) {
						hasMatchingDescendant = true;
					}
				}

				const isDirectMatch = isNodeMatching(node, hierarchySearchTerm);
				if (isDirectMatch) {
					directMatches.push(node.key);
				}

				if (isDirectMatch || hasMatchingDescendant) {
					currentPath.forEach((key) => matchingParentKeys.add(key));
					return true;
				}
				return false;
			};

			searchAndExpand($hierarchy, []);
			expandedKeys = matchingParentKeys;
			searchMatches = directMatches;

			// If there are matches, select the first one automatically
			if (searchMatches.length > 0) {
				currentMatchIndex = 0;
				selectedNode.set(findNodeByKey($hierarchy, searchMatches[0]));
			} else {
				currentMatchIndex = -1;
			}
		}
	}

	/**
	 * Navigates to the next search match.
	 */
	function nextMatch() {
		if (searchMatches.length === 0) return;
		currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
		const key = searchMatches[currentMatchIndex];
		if ($hierarchy) {
			selectedNode.set(findNodeByKey($hierarchy, key));
		}
	}

	/**
	 * Navigates to the previous search match.
	 */
	function previousMatch() {
		if (searchMatches.length === 0) return;
		currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
		const key = searchMatches[currentMatchIndex];
		if ($hierarchy) {
			selectedNode.set(findNodeByKey($hierarchy, key));
		}
	}

	/**
	 * Reactive block to scroll the selected element into view in the hierarchy tree.
	 */
	$: if ($selectedNode && rightTab === 'hierarchy') {
		tick().then(() => {
			const element = document.getElementById(`hierarchy-node-${$selectedNode.key}`);
			if (element) {
				element.scrollIntoView({
					behavior: 'smooth',
					block: 'center', // Center the element in the view
					inline: 'center'
				});
			}
		});
	}

	/**
	 * Reactive block to auto-refresh the hierarchy when the tab is switched to.
	 */
	$: if (rightTab === 'hierarchy' && $selectedSerial) {
		refreshHierarchy();
	}

	/**
	 * Derived store to generate a suggested XPath selector for the selected node.
	 */
	const generatedXPath = derived(selectedNode, ($node) => {
		if (!$node?.properties) return 'Select an element to see its XPath';
		const p = $node.properties;
		if (p['resource-id']) return `//*[@resource-id='${p['resource-id']}']`;
		if (p['content-desc']) return `//*[@content-desc='${p['content-desc']}']`;
		if (p['text']) return `//*[contains(@text, "${p['text']}")]`;
		return `//${$node.name}`;
	});

	// ─── Legacy Integration ──────────────────────────────────────────────────────────────────────
	let getAppVariables = () => ({});
	let callBackend: any = () => Promise.resolve();
	let updateMessage: any = () => {};
	let PythonConsoleManager = { init: () => {}, refresh: () => {} };
	let escapeHtml = (s: string) => s;
	let openGlobalTab = (_evt: any, _name: string) => {};

	onMount(() => {
		if ((window as any).getAppVariablesForLlm)
			getAppVariables = (window as any).getAppVariablesForLlm;
		if ((window as any).callBackend) callBackend = (window as any).callBackend;
		if ((window as any).updateMessage) updateMessage = (window as any).updateMessage;
		if ((window as any).PythonConsoleManager)
			PythonConsoleManager = (window as any).PythonConsoleManager;
		if ((window as any).escapeHtml) escapeHtml = (window as any).escapeHtml;
		if ((window as any).openGlobalTab) openGlobalTab = (window as any).openGlobalTab;
	});
</script>

<style>
	:global(body) {
		margin: 0;
		background: #111;
		color: #fff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
			Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
	}

	main {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.layout {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		padding: 0.5rem;
		min-height: 0;
		overflow: hidden;
	}

	.panel {
		background: #1e1e1e;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid #333;
	}

	.panel-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
		font-weight: bold;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
	}

	.panel-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.left-panel {
		flex: 0 0 30%;
		min-width: 300px;
		max-width: 420px;
	}

	.screenshot-wrapper {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		padding: 0.5rem;
		min-height: 0;
	}

	.middle-panel {
		flex: 0 0 35%;
		min-width: 300px;
	}

	.right-panel {
		flex: 1;
		min-width: 250px;
	}

	.tabs {
		display: flex;
		background: #252526;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
	}

	.tab-button {
		padding: 0.6rem 1rem;
		cursor: pointer;
		background: transparent;
		border: none;
		color: #888;
		border-bottom: 2px solid transparent;
		font-size: 0.9rem;
		transition: color 0.2s ease;
	}

	.tab-button:hover {
		color: #ccc;
	}

	.tab-button.active {
		color: #fff;
		border-bottom-color: #007acc;
	}

	.tab-content {
		flex: 1;
		overflow: auto;
		padding: 0; /* Changed from 1rem to 0 to allow components to control their own padding */
		display: flex;
		flex-direction: column;
	}

	.right-panel .panel-content {
		padding: 0;
	}

	.hierarchy-controls {
		padding: 0.5rem;
		flex-shrink: 0;
		background: #1e1e1e;
		border-bottom: 1px solid #333;
		position: relative;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.search-input {
		flex-grow: 1;
		box-sizing: border-box;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		border: 1px solid #3c3c3c;
		background: #2a2a2a;
		color: #fff;
		font-size: 13px;
	}
	.search-input:focus {
		outline: 1px solid #007acc;
	}

	.search-nav {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 12px;
		color: #aaa;
	}

	.search-nav button {
		background: #3c3c3c;
		border: 1px solid #555;
		color: #ddd;
		border-radius: 4px;
		cursor: pointer;
		font-weight: bold;
		padding: 2px 8px;
		line-height: 1.5;
	}
	.search-nav button:hover {
		background: #4f4f4f;
	}

	.tree-wrapper {
		flex-grow: 1;
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: #555 #2a2a2a;
	}
</style>

<main>
	<div class="layout">
		<div class="panel left-panel">
			<div class="panel-title">
				<span>Device</span>
				<DeviceSelectorPanel />
			</div>
			<div class="panel-content">
				<div class="screenshot-wrapper">
					<DeviceScreenshot />
				</div>
			</div>
		</div>

		<div class="panel middle-panel">
			<div class="tabs">
				<button
					class="tab-button"
					class:active={midTab === 'assistant'}
					on:click={() => (midTab = 'assistant')}
				>
					LLM Assistant
				</button>
				<button
					class="tab-button"
					class:active={midTab === 'details'}
					on:click={() => (midTab = 'details')}
				>
					Element Details
				</button>
			</div>
			<div class="panel-content">
				{#if midTab === 'assistant'}
					<LLMAssistant
						{getAppVariables}
						{callBackend}
						{updateMessage}
						{PythonConsoleManager}
						{escapeHtml}
						{openGlobalTab}
					/>
				{:else}
					<PropertiesPanel generatedXPath={$generatedXPath} selectedNode={$selectedNode} />
				{/if}
			</div>
		</div>

		<div class="panel right-panel">
			<div class="tabs">
				<button
					class="tab-button"
					class:active={rightTab === 'python'}
					on:click={() => (rightTab = 'python')}
				>
					Python Console
				</button>
				<button
					class="tab-button"
					class:active={rightTab === 'hierarchy'}
					on:click={() => (rightTab = 'hierarchy')}
				>
					UI Hierarchy
				</button>
			</div>
			<div class="panel-content">
				{#if rightTab === 'python'}
					<!-- The PythonConsole no longer needs extra padding -->
					<PythonConsole serial={$selectedSerial} />
				{:else}
					{#if $isLoadingHierarchy}
						<p style="padding: 1rem; color: #888;">Loading UI hierarchy…</p>
					{:else if $hierarchyError}
						<p style="color: #e53935; padding: 1rem;">Error: {$hierarchyError}</p>
					{:else if !$hierarchy}
						<p style="padding: 1rem; color: #888;">No hierarchy available. Select a device.</p>
					{:else}
						<div class="hierarchy-controls">
							<input
								type="text"
								class="search-input"
								placeholder="Search name, text, or resource-id…"
								bind:value={hierarchySearchTerm}
							/>
							{#if hierarchySearchTerm && searchMatches.length > 0}
								<div class="search-nav">
									<span>
										{currentMatchIndex + 1} of {searchMatches.length}
									</span>
									<button on:click={previousMatch} title="Previous Match">‹</button>
									<button on:click={nextMatch} title="Next Match">›</button>
								</div>
							{/if}
						</div>
						<div class="tree-wrapper">
							<ul style="padding-left: 0.5rem;">
								<HierarchyTree
									node={$hierarchy}
									bind:expanded={expandedKeys}
									searchTerm={hierarchySearchTerm}
									currentMatchKey={searchMatches[currentMatchIndex]}
								/>
							</ul>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- ✅ Floating Console Output: Rendered here, on top of everything else. -->
	{#if $pythonConsoleStore.isOpen}
		<ConsoleOutput />
	{/if}
</main>

