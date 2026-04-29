import { create, type StoreApi, type UseBoundStore } from 'zustand';

const MAX_HISTORY_SIZE = 50;

interface NavigationHistoryState<T> {
    history: T[];
    currentIndex: number;

    push: (entry: T) => void;
    remove: (predicate: (entry: T) => boolean) => void;
    goBack: () => T | undefined;
    goForward: () => T | undefined;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    reset: () => void;
}

/**
 * Creates a reusable navigation history store.
 * Each webview instantiates its own store with a specific entry type (e.g. deviceUID string).
 *
 * Behaves like browser history:
 * - push() appends, clears forward history, caps at MAX_HISTORY_SIZE
 * - goBack()/goForward() move the index only
 * - De-duplicates consecutive identical entries (also prevents push from re-adding
 *   the entry that goBack/goForward just navigated to)
 */
export function createNavigationHistoryStore<T>(): UseBoundStore<StoreApi<NavigationHistoryState<T>>> {
    return create<NavigationHistoryState<T>>((set, get) => ({
        history: [],
        currentIndex: -1,

        push: (entry: T) => {
            const state = get();

            // De-duplicate: skip if entry is same as current
            if (state.history.length > 0 && state.currentIndex >= 0) {
                const current = state.history[state.currentIndex];
                if (current === entry) {
                    return;
                }
            }

            // Truncate forward history
            const newHistory = state.history.slice(0, state.currentIndex + 1);
            newHistory.push(entry);

            // Cap at MAX_HISTORY_SIZE by evicting from the front
            if (newHistory.length > MAX_HISTORY_SIZE) {
                const overflow = newHistory.length - MAX_HISTORY_SIZE;
                newHistory.splice(0, overflow);
            }

            set({
                history: newHistory,
                currentIndex: newHistory.length - 1,
            });
        },

        remove: (predicate: (entry: T) => boolean) => {
            const state = get();
            const filtered = state.history.filter(entry => !predicate(entry));

            if (filtered.length === 0) {
                set({ history: [], currentIndex: -1 });
                return;
            }

            // Count how many removed entries were at or before currentIndex
            // so we can shift the pointer by the right amount.
            let removedBeforeOrAt = 0;
            for (let index = 0; index <= state.currentIndex && index < state.history.length; index++) {
                if (predicate(state.history[index])) {
                    removedBeforeOrAt++;
                }
            }

            let adjustedIndex = Math.min(
                Math.max(state.currentIndex - removedBeforeOrAt, 0),
                filtered.length - 1,
            );

            // Collapse consecutive duplicates that may have formed after removal
            // (e.g. [X, Y, X] – remove Y → [X, X] → [X])
            const deduped: T[] = [filtered[0]];
            // Map old filtered indices → new deduped indices so we can adjust the pointer
            const indexMap: number[] = [0];
            for (let index = 1; index < filtered.length; index++) {
                if (filtered[index] === filtered[index - 1]) {
                    // Duplicate: map this old index to the same deduped position
                    indexMap.push(deduped.length - 1);
                } else {
                    deduped.push(filtered[index]);
                    indexMap.push(deduped.length - 1);
                }
            }

            const newIndex = Math.min(
                indexMap[adjustedIndex] ?? 0,
                deduped.length - 1,
            );

            set({ history: deduped, currentIndex: deduped.length === 0 ? -1 : newIndex });
        },

        goBack: () => {
            const state = get();
            console.log('goBack called [before]', state.history, state.currentIndex);
            if (state.currentIndex <= 0) {
                return;
            }

            const newIndex = state.currentIndex - 1;
            set({ currentIndex: newIndex });
            console.log('goBack called [after]', state.history, newIndex);

            return state.history[newIndex];
        },

        goForward: () => {
            const state = get();
            console.log('goForward [before]', state.history, state.currentIndex);
            if (state.currentIndex >= state.history.length - 1) {
                return;
            }

            const newIndex = state.currentIndex + 1;
            set({ currentIndex: newIndex });
            console.log('goForward [after]', state.history, newIndex);

            return state.history[newIndex];
        },

        canGoBack: () => {
            const state = get();
            return state.currentIndex > 0;
        },

        canGoForward: () => {
            const state = get();
            return state.currentIndex < state.history.length - 1;
        },

        reset: () => {
            set({
                history: [],
                currentIndex: -1,
            });
        },
    }));
}

export type { NavigationHistoryState };
