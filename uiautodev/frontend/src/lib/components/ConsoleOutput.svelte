<!-- src/lib/components/ConsoleOutput.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { pythonConsoleStore } from '$lib/stores/pythonConsole';
  import { get } from 'svelte/store';

  // Subscribe to our store
  let unsubscribe: () => void;
  let lines: string[] = [];

  // Panel height (px)
  let height = 180;

  // Track dragging state
  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  // Reference for the panel element
  let panelEl: HTMLDivElement;

  onMount(() => {
    // Sync store.output → lines
    unsubscribe = pythonConsoleStore.subscribe(($s) => {
      lines = $s.output;
    });

    // Mouse move/up handlers
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dy = startY - e.clientY;
      const newHeight = startHeight + dy;
      height = Math.max(60, Math.min(newHeight, window.innerHeight - 100));
    };
    const handleMouseUp = () => {
      isDragging = false;
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

  onDestroy(() => {
    unsubscribe && unsubscribe();
  });

  // Start dragging
  function handleDragStart(e: MouseEvent) {
    isDragging = true;
    startY = e.clientY;
    startHeight = height;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }
</script>

<style>
  .output-panel {
    display: flex;
    flex-direction: column;
    background: var(--dark-bg-primary);
    border-top: 2px solid var(--dark-accent-primary);
    overflow: hidden;
  }
  .drag-handle {
    height: 12px;
    background: var(--dark-border-secondary);
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .drag-handle::before {
    content: '•••';
    color: var(--dark-text-placeholder);
    font-size: 1.2em;
    line-height: 0;
    letter-spacing: 2px;
  }
  .output-content {
    flex: 1;
    padding: 8px;
    overflow-y: auto;
    font-family: var(--font-family-monospace);
    font-size: 12px;
    color: var(--dark-text-secondary);
    background: var(--dark-bg-primary);
  }
  .line {
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>

<div
  class="output-panel"
  bind:this={panelEl}
  style="height: {height}px;"
>
  <!-- Drag handle -->
  <div
    class="drag-handle"
    on:mousedown|preventDefault={handleDragStart}
  ></div>

  <!-- Output lines -->
  <div class="output-content">
    {#if lines.length === 0}
      <div class="line"># No output</div>
    {:else}
      {#each lines as line}
        <div class="line">{line}</div>
      {/each}
    {/if}
  </div>
</div>

