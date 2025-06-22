<script lang="ts">
	import { onMount } from 'svelte';
	import { devices, selectedSerial, type DeviceInfo } from '$lib/stores/uiagent';

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
	}
</script>

<style>
	select {
		/* Adjusted for use in a header */
		min-width: 150px;
		padding: 0.25rem 0.5rem; /* Smaller padding */
		border-radius: 4px;
		border: 1px solid #444;
		background-color: #2a2a2a;
		color: #fff;
		font-size: 0.85rem; /* Smaller font */
		-webkit-appearance: none;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 0.5rem center;
		background-size: 1em;
		padding-right: 2rem; /* Make space for the arrow */
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
{/if}
