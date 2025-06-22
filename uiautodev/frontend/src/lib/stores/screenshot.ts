// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT STATE STORE
// This store holds the state related to the device screenshot itself, primarily
// its rendered dimensions on the screen. The UI hierarchy provides normalized
// bounds (e.g., from 0.0 to 1.0), so we need the actual pixel dimensions of the
// image to scale those bounds into coordinates for our overlay.
// ─────────────────────────────────────────────────────────────────────────────

import { writable } from 'svelte/store';

// -----------------------------------------------------------------------------
// INTERFACE
// Defines the shape of the data we need to store.
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
// STORE
// We create a writable store with a default state. Components can update
// this store, and any other component subscribed to it will react to the change.
// -----------------------------------------------------------------------------
export const screenshotStore = writable<ScreenshotState>({
    renderedWidth: 0,
    renderedHeight: 0,
    naturalWidth: 0,
    naturalHeight: 0,
});

