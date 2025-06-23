<script lang="ts">
	import { onMount } from 'svelte';
	import { devices, selectedSerial, type DeviceInfo } from '$lib/stores/uiagent';

	// 1. IMPORT our new refresh function from the store.
	import { refreshScreenshot } from '$lib/stores/screenshot';

	let isLoading = true;
	let error: string | null = null;

	onMount(() => {
		fetch('/api/android/list')
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then((data: DeviceInfo[]) => {
				devices.set(data);
				if (data.length > 0 && !$selectedSerial) {
					selectedSerial.set(data[0].serial);
				}
			})
			.catch((err) => {
				console.error('❌ Failed to load devices:', err);
				error = err.message;
				devices.set([]);
			})
			.finally(() => {
				isLoading = false;
			});
	});

	function onDeviceChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		selectedSerial.set(target.value);
		// 2. (Good Practice) Also trigger a refresh when the device is changed.
		refreshScreenshot();
	}
</script>

<style>
	/* 3. ADD these new styles for the button and its wrapper. */
	.device-selector-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.refresh-btn {
		background: transparent;
		border: 1px solid #444;
		color: #ccc;
		padding: 0.25rem;
		border-radius: 4px;
		cursor: pointer;
		line-height: 1;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background-color 0.2s,
			border-color 0.2s;
	}
	.refresh-btn:hover:not(:disabled) {
		background-color: #3e3e3e;
		border-color: #666;
	}
	.refresh-btn:active:not(:disabled) {
		background-color: #2a2a2a;
	}
	.refresh-btn:disabled {
		color: #666;
		cursor: not-allowed;
	}

	/* No changes needed to existing styles below. */
	select {
		min-width: 150px;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid #444;
		background-color: #2a2a2a;
		color: #fff;
		font-size: 0.85rem;
		-webkit-appearance: none;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 0.5rem center;
		background-size: 1em;
		padding-right: 2rem;
	}
	select:disabled {
		opacity: 0.5;
	}
	.error-text {
		color: #f87171;
		font-size: 0.8rem;
		text-align: right;
	}
</style>

{#if error}
	<span class="error-text">{error}</span>
{:else}
	<div class="device-selector-wrapper">
		<select
			id="device-select"
			value={$selectedSerial}
			on:change={onDeviceChange}
			disabled={isLoading || $devices.length === 0}
			aria-label="Select Device"
		>
			{#if isLoading}
				<option value="" disabled>Loading…</option>
			{:else if $devices.length > 0}
				{#each $devices as device (device.serial)}
					<option value={device.serial}>
						{device.serial}{device.model ? ` (${device.model})` : ''}
					</option>
				{/each}
			{:else}
				<option value="" disabled>No devices found</option>
			{/if}
		</select>

		<button
			class="refresh-btn"
			on:click={refreshScreenshot}
			disabled={!$selectedSerial || isLoading}
			title="Refresh Screenshot"
		>
			🔄
		</button>
	</div>
{/if}
