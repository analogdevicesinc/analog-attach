import { createNavigationHistoryStore } from 'attach-ui-lib';

/**
 * Navigation history store for the tree-editor webview.
 * Tracks deviceUID strings as history entries.
 */
export const useNavigationHistoryStore = createNavigationHistoryStore<string>();
