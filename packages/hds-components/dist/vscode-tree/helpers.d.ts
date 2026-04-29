import type { VscodeTreeItem } from '../vscode-tree-item/vscode-tree-item.js';
import type { VscodeTree } from './vscode-tree.js';
export declare const initPathTrackerProps: (parentElement: VscodeTree | VscodeTreeItem, items: VscodeTreeItem[]) => void;
export declare const findLastChildItem: (item: VscodeTreeItem) => VscodeTreeItem;
export declare const findClosestAncestorHasNextSibling: (item: VscodeTreeItem) => VscodeTreeItem | null;
export declare const findNextItem: (item: VscodeTreeItem) => VscodeTreeItem | null;
export declare const findPrevItem: (item: VscodeTreeItem) => VscodeTreeItem | null;
export declare function findParentItem(childItem: VscodeTreeItem): VscodeTreeItem | null;
//# sourceMappingURL=helpers.d.ts.map