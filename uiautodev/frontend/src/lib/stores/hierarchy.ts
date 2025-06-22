// ─────────────────────────────────────────────────────────────────────────────
// HIERARCHY DATA STORE
// This store's job is to manage the state of the main UI hierarchy tree. It
// handles fetching the data from the backend, tracking loading and error states,
// and providing convenient, processed versions of the data for components to use.
// ─────────────────────────────────────────────────────────────────────────────

import { get, writable, derived } from 'svelte/store';
import type { NodeInfo } from './uiagent';
// We import a store from another file. This is the magic of Svelte stores;
// they allow different parts of our application to easily talk to each other.
import { selectedSerial } from './uiagent';

// -----------------------------------------------------------------------------
// PRIMARY HIERARCHY STORES
// These are the core state variables for the hierarchy feature.
// -----------------------------------------------------------------------------

/** A writable store that holds the root NodeInfo object of the UI tree. */
export const hierarchy = writable<NodeInfo | null>(null);

/** A boolean store that is `true` while the hierarchy is being fetched. */
export const isLoadingHierarchy = writable<boolean>(false);

/** A string store that holds an error message if the fetch fails. */
export const hierarchyError = writable<string | null>(null);

// -----------------------------------------------------------------------------
// DATA FETCHING ACTION
// An `async` function that fetches the hierarchy for the currently selected
// device and updates the stores accordingly.
// -----------------------------------------------------------------------------
export async function refreshHierarchy() {
    // `get()` provides a one-time, non-reactive snapshot of a store's value.
    const serial = get(selectedSerial);
    if (!serial) {
        hierarchy.set(null); // If no device is selected, clear the hierarchy.
        return;
    }

    // Set loading state and clear any previous errors.
    isLoadingHierarchy.set(true);
    hierarchyError.set(null);

    try {
        const resp = await fetch(`/api/android/${serial}/hierarchy?format=json`);
        if (!resp.ok) {
            throw new Error(`Failed to fetch hierarchy: HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as NodeInfo;
        hierarchy.set(data); // On success, update the store with the new data.
    } catch (e: any) {
        hierarchyError.set(e.message || 'An unknown error occurred');
        hierarchy.set(null); // On error, clear the hierarchy.
    } finally {
        isLoadingHierarchy.set(false); // Always turn off loading state.
    }
}

// -----------------------------------------------------------------------------
// DERIVED STORE FOR EFFICIENT LOOKUPS
// A "derived" store creates a new store value based on one or more other
// stores. This is incredibly efficient because it only recomputes its value
// when the stores it depends on (`hierarchy` in this case) actually change.
// -----------------------------------------------------------------------------

/**
 * A derived store that transforms the hierarchy tree into a Map for fast
 * node lookups by key. The `HierarchyTree` component can use this to quickly
 * find a node without having to search the entire tree every time.
 */
export const nodesByKey = derived(hierarchy, ($hierarchy) => {
    const map = new Map<string, NodeInfo>();
    if (!$hierarchy) return map;

    // A recursive function to traverse the tree and populate the map.
    function recurse(node: NodeInfo) {
        map.set(node.key, node);
        node.children.forEach(recurse);
    }
    recurse($hierarchy);
    return map;
});


// -----------------------------------------------------------------------------
// REACTIVE SUBSCRIPTION
// This is the glue that connects the device selection to the hierarchy data.
// We `subscribe` to the `selectedSerial` store. Whenever its value changes,
// the function we provide is automatically executed.
// -----------------------------------------------------------------------------
selectedSerial.subscribe((serial) => {
    if (serial) {
        // If a new device serial is selected, automatically fetch its hierarchy.
        refreshHierarchy();
    } else {
        // If the selection is cleared, clear the hierarchy data.
        hierarchy.set(null);
    }
});

