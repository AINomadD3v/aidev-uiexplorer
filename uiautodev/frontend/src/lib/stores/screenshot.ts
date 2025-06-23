// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT STATE STORE
// This store holds state related to the device screenshot. It contains two parts:
// 1. `screenshotStore`: Stores the dimensions of the rendered screenshot image,
//    which is crucial for scaling UI element boundaries correctly.
// 2. `screenshotRefreshTrigger`: A mechanism to manually force a reload of the
//    screenshot image from the backend.
// ─────────────────────────────────────────────────────────────────────────────

import { writable } from 'svelte/store';

// -----------------------------------------------------------------------------
// INTERFACE
// Defines the shape of the data for the screenshot's dimensions.
// -----------------------------------------------------------------------------
export interface ScreenshotState {
	/** The actual width of the <img> element on the screen. */
	renderedWidth: number;
	/** The actual height of the <img> element on the screen. */
	renderedHeight: number;
	/** The natural, original width of the screenshot image file. */
	naturalWidth: number;
	/** The natural, original height of the screenshot image file. */
	naturalHeight: number;
}

// -----------------------------------------------------------------------------
// STORE - DIMENSIONS
// Stores the screenshot dimension data. Components can update this, and any
// subscribed components will react to the change.
// -----------------------------------------------------------------------------
export const screenshotStore = writable<ScreenshotState>({
	renderedWidth: 0,
	renderedHeight: 0,
	naturalWidth: 0,
	naturalHeight: 0
});

// -----------------------------------------------------------------------------
// STORE & ACTION - REFRESH TRIGGER
// This provides the logic for manually refreshing the screenshot.
// -----------------------------------------------------------------------------

/**
 * A writable store that holds a timestamp. Its value is used as a cache-busting
 * query parameter in the screenshot's URL. Changing this value will trigger a
 * re-fetch of the image in any component that uses it.
 */
export const screenshotRefreshTrigger = writable(Date.now());

/**
 * Updates the refresh trigger with the current timestamp. Call this exported
 * function from any component (e.g., from a button's on:click event) to
 * force a manual refresh of the device screenshot.
 */
export function refreshScreenshot() {
	screenshotRefreshTrigger.set(Date.now());
}
