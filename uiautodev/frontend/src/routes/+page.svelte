<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { derived } from 'svelte/store';

  // UI panels
  import DeviceSelectorPanel from '$lib/components/DeviceSelectorPanel.svelte';
  import DeviceScreenshot     from '$lib/components/DeviceScreenshot.svelte';
  import LLMAssistant         from '$lib/components/LLMAssistant.svelte';
  import PropertiesPanel      from '$lib/components/PropertiesPanel.svelte';
  import PythonConsole        from '$lib/components/PythonConsole.svelte';
  import HierarchyTree        from '$lib/components/HierarchyTree.svelte';

  // your store for the selected node
  import { selectedNode } from '$lib/stores/uiagent';

  // mid- and right-panel tab state
  let midTab: 'assistant' | 'details' = 'assistant';
  let rightTab: 'python' | 'hierarchy' = 'python';

  // generate XPath exactly as before
  const generatedXPath = derived(selectedNode, ($node) => {
    if (!$node?.properties) return '';
    const p = $node.properties!;
    if      (p['resource-id'])   return `//*[@resource-id='${p['resource-id']}']`;
    else if (p['content-desc'])  return `//*[@content-desc='${p['content-desc']}']`;
    else if (p['text'])          return `//*[contains(text(),"${p['text']}")]`;
    else                          return `//${$node.name}`;
  });

  // legacy deps wired up on mount
  let getAppVariables: () => any;
  let callBackend:       typeof fetch;
  let updateMessage:     (txt: string, type?: string, dur?: number) => void;
  let PythonConsoleManager: any;
  let escapeHtml:        (s: string) => string;
  let openGlobalTab:     (evt: any, tabName: string) => void;

  onMount(() => {
    getAppVariables      = (window as any).getAppVariablesForLlm;
    callBackend          = (window as any).callBackend;
    updateMessage        = (window as any).updateMessage;
    PythonConsoleManager = (window as any).PythonConsoleManager;
    escapeHtml           = (window as any).escapeHtml;
    openGlobalTab        = (window as any).openGlobalTab;
  });
</script>

<style>
  /* --- Global Reset & Dark Theme --- */
  :global(body) {
    margin: 0;
    background: #111;
    color: #fff;
    font-family: sans-serif;
  }

  /* --- Root Layout --- */
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* --- Panels Container --- */
  .layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* --- Common Panel Styles --- */
  .panel {
    background: #1a1a1a;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin: 0.5rem;
  }
  .panel .title {
    padding: 0.8rem 1rem;
    font-size: 0.9rem;
    font-weight: bold;
    border-bottom: 1px solid #333;
    flex: 0 0 auto;
  }
  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 0;
  }

  /* --- Left Panel: Device + Screenshot --- */
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
    overflow: hidden;
    background: #000;
  }

  /* --- Middle Panel: LLM / Element Details (now narrower) --- */
  .middle-panel {
    flex: 0 0 35%;
    min-width: 300px;
  }
  .tabs {
    display: flex;
    background: #222;
    border-bottom: 1px solid #333;
    flex: 0 0 auto;
  }
  .tab-button {
    padding: 0.6rem 1rem;
    cursor: pointer;
    background: transparent;
    border: none;
    color: #888;
    border-bottom: 2px solid transparent;
    font-size: 0.9rem;
  }
  .tab-button.active {
    color: #fff;
    border-bottom-color: #007acc;
  }
  .tab-panel {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }

  /* --- Right Panel: Python / Hierarchy --- */
  .right-panel {
    flex: 1;
    min-width: 250px;
  }
</style>

<main>
  <div class="layout">
    <!-- Left -->
    <div class="panel left-panel">
      <div class="title">Device</div>
      <div class="panel-content">
        <DeviceSelectorPanel />
        <div class="screenshot-wrapper">
          <DeviceScreenshot />
        </div>
      </div>
    </div>

    <!-- Middle -->
    <div class="panel middle-panel">
      <div class="tabs">
        <button
          class="tab-button"
          class:active={midTab === 'assistant'}
          on:click={() => (midTab = 'assistant')}
        >LLM Assistant</button>
        <button
          class="tab-button"
          class:active={midTab === 'details'}
          on:click={() => (midTab = 'details')}
        >Element Details</button>
      </div>
      <div class="tab-panel">
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
          <PropertiesPanel
            generatedXPath={$generatedXPath}
            selectedNode={$selectedNode}
          />
        {/if}
      </div>
    </div>

    <!-- Right -->
    <div class="panel right-panel">
      <div class="tabs">
        <button
          class="tab-button"
          class:active={rightTab === 'python'}
          on:click={() => (rightTab = 'python')}
        >Python Console</button>
        <button
          class="tab-button"
          class:active={rightTab === 'hierarchy'}
          on:click={() => (rightTab = 'hierarchy')}
        >UI Hierarchy</button>
      </div>
      <div class="tab-panel">
        {#if rightTab === 'python'}
          <PythonConsole />
        {:else}
          <HierarchyTree />
        {/if}
      </div>
    </div>
  </div>
</main>

