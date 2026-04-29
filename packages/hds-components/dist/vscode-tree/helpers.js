const isTreeItem = (item) => item instanceof Element && item.matches('vscode-tree-item');
const isTreeRoot = (item) => item instanceof Element && item.matches('vscode-tree');
export const initPathTrackerProps = (parentElement, items) => {
    const numChildren = items.length;
    const parentElementLevel = isTreeRoot(parentElement)
        ? -1
        : parentElement.level;
    if ('branch' in parentElement) {
        parentElement.branch = numChildren > 0;
    }
    items.forEach((item, i) => {
        if ('path' in parentElement) {
            item.path = [...parentElement.path, i];
        }
        else {
            item.path = [i];
        }
        item.level = parentElementLevel + 1;
        item.dataset.path = item.path.join('.');
    });
};
export const findLastChildItem = (item) => {
    const lastItem = item.lastElementChild;
    if (!lastItem || !isTreeItem(lastItem)) {
        return item;
    }
    if (lastItem.branch && lastItem.open) {
        return findLastChildItem(lastItem);
    }
    else {
        return lastItem;
    }
};
export const findClosestAncestorHasNextSibling = (item) => {
    if (!item.parentElement) {
        return null;
    }
    if (!isTreeItem(item.parentElement)) {
        return null;
    }
    const nextSiblingOfParent = findNextTreeItemElementSibling(item.parentElement);
    if (nextSiblingOfParent) {
        return nextSiblingOfParent;
    }
    else {
        return findClosestAncestorHasNextSibling(item.parentElement);
    }
};
const findNextTreeItemElementSibling = (item) => {
    let nextSibling = item.nextElementSibling;
    while (nextSibling && !isTreeItem(nextSibling)) {
        nextSibling = nextSibling.nextElementSibling;
    }
    return nextSibling;
};
export const findNextItem = (item) => {
    const { parentElement } = item;
    if (!parentElement || !isTreeItem(item)) {
        return null;
    }
    let nextItem;
    if (item.branch && item.open) {
        const firstChildItem = item.querySelector('vscode-tree-item');
        if (!firstChildItem) {
            nextItem = findNextTreeItemElementSibling(item);
            if (!nextItem) {
                nextItem = findClosestAncestorHasNextSibling(item);
            }
        }
        else {
            nextItem = firstChildItem;
        }
    }
    else {
        nextItem = findNextTreeItemElementSibling(item);
        if (!nextItem) {
            nextItem = findClosestAncestorHasNextSibling(item);
        }
    }
    if (!nextItem) {
        return item;
    }
    else {
        return nextItem;
    }
};
export const findPrevItem = (item) => {
    const { parentElement } = item;
    if (!parentElement || !isTreeItem(item)) {
        return null;
    }
    let prevSibling = item.previousElementSibling;
    while (prevSibling && !isTreeItem(prevSibling)) {
        prevSibling = prevSibling.previousElementSibling;
    }
    if (!prevSibling) {
        if (isTreeItem(parentElement)) {
            return parentElement;
        }
    }
    if (prevSibling && prevSibling.branch && prevSibling.open) {
        const lastChild = findLastChildItem(prevSibling);
        return lastChild;
    }
    return prevSibling;
};
export function findParentItem(childItem) {
    if (!childItem.parentElement) {
        return null;
    }
    if (!isTreeItem(childItem.parentElement)) {
        return null;
    }
    return childItem.parentElement;
}
//# sourceMappingURL=helpers.js.map