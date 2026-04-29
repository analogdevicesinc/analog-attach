import { create } from 'zustand';
import type { TreeNode, PathSegment } from '../types';
import { mockData } from '../mockData';
import { TreeViewCommands } from 'extension-protocol';
import type { GetDeviceTreeResponse, FormObjectElement, GetDeviceTreeRequest, FormElement } from 'extension-protocol';
import { useVscodeStore } from 'attach-ui-lib';
import { useNavigationHistoryStore } from './useNavigationHistoryStore';

// Helper function to convert FormElement to TreeNode
const convertFormElementToTreeNode = (formElement: any): TreeNode => {
    const label = formElement.alias || formElement.key;
    return {
        label,
        hasErrors: (formElement as FormElement).error !== undefined, // FormElement doesn't have error info, could be derived from validation
        expanded: false, // Default to collapsed
        data: formElement,
        children: formElement.config ? (formElement.config as FormElement[]).map((element) => convertFormElementToTreeNode(element as FormObjectElement)) : [],
    };
};

// Helper function to flatten the tree structure for navigation
const getFlattenedNodes = (nodes: TreeNode[]): TreeNode[] => {
    const flatList: TreeNode[] = [];

    const flattenRecursively = (nodeList: TreeNode[]) => {
        for (const node of nodeList) {
            flatList.push(node);
            if (node.children) {
                flattenRecursively(node.children);
            }
        }
    };

    flattenRecursively(nodes);
    return flatList;
};

// Helper function to recursively update a node in the tree
const updateNodeInTree = (
    nodes: TreeNode[],
    targetNode: TreeNode,
    updater: (node: TreeNode) => TreeNode
): TreeNode[] => {
    return nodes.map(node => {
        if (node === targetNode) {
            return updater(node);
        }
        if (node.children) {
            return { ...node, children: updateNodeInTree(node.children, targetNode, updater) };
        }
        return node;
    });
};

// Helper to map a path of TreeNodes to rich PathSegment[] identifiers
const mapPathToSegments = (pathNodes: TreeNode[]): PathSegment[] =>
    pathNodes.map((n) => {
        const data = n.data as FormObjectElement;
        return {
            key: data.key ?? n.label,
            label: n.label,
            uid: data.deviceUID ?? undefined,
        };
    });

/**
 * Match a PathSegment against a TreeNode.
 * Priority: uid (if segment has one) → key + label.
 */
const segmentMatchesNode = (segment: PathSegment, node: TreeNode): boolean => {
    const data = node.data as FormObjectElement;
    const nodeKey = data.key ?? node.label;

    // If the segment carries a uid, try that first (most reliable)
    if (segment.uid && data.deviceUID === segment.uid) {
        return true;
    }

    // If both carry a uid but they differ, this is definitely not the same node —
    // do not fall through to the weaker key+label check which could match a
    // different node that merely shares the same name (e.g. after deletion).
    if (segment.uid && data.deviceUID) {
        return false;
    }

    // key + label match (disambiguates siblings that share the same key)
    if (nodeKey === segment.key && node.label === segment.label) {
        return true;
    }

    return false;
};

/**
 * Loose match: only compares by key (ignores label/uid).
 * Used as a last-resort fallback so that a renamed alias doesn't
 * completely break path resolution.
 */
const segmentLooseMatchesNode = (segment: PathSegment, node: TreeNode): boolean => {
    const data = node.data as FormObjectElement;
    const nodeKey = data.key ?? node.label;
    return nodeKey === segment.key;
};

/**
 * Walk the tree following a PathSegment[] path.
 * At each level, tries strict matching first (uid / key+label),
 * then falls back to loose key-only matching.
 */
const resolvePathInTree = (roots: TreeNode[], segments: PathSegment[]): TreeNode | undefined => {
    const [head, ...rest] = segments;
    if (!head) {
        return undefined;
    }

    // Try strict match first, then loose
    const match =
        roots.find((n) => segmentMatchesNode(head, n)) ??
        roots.find((n) => segmentLooseMatchesNode(head, n));

    if (!match) {
        return undefined;
    }

    if (rest.length === 0) {
        return match;
    }

    return match.children ? resolvePathInTree(match.children, rest) : undefined;
};

// Helper to find the path from root to a target node (returns array of nodes along the way)
const findPathToNode = (nodes: TreeNode[], target: TreeNode): TreeNode[] | undefined => {
    for (const node of nodes) {
        if (node === target) {
            return [node];
        }
        if (node.children) {
            const childPath = findPathToNode(node.children, target);
            if (childPath) {
                return [node, ...childPath];
            }
        }
    }
    return undefined;
};

interface NodesState {
    // State
    nodes: TreeNode[];
    selectedNode?: TreeNode;
    selectedNodePath?: PathSegment[];
    isLoading: boolean;
    error?: string;
    isReadOnly: boolean;
    isDtso: boolean;

    // Actions
    setNodes: (nodes: TreeNode[]) => void;
    selectNode: (node?: TreeNode, options?: { skipHistory?: boolean }) => void;
    selectNextNode: () => void;
    selectPreviousNode: () => void;
    setLoading: (loading: boolean) => void;
    setError: (error?: string) => void;
    loadNodes: () => Promise<void>;
    initialize: () => void;
    reset: () => void;

    // Tree-specific actions
    toggleNodeExpansion: (node: TreeNode) => void;
    setNodeExpansion: (node: TreeNode, expanded: boolean) => void;
    updateNode: (node: TreeNode, updates: Partial<TreeNode>) => void;
    deleteNode: (node: TreeNode) => void;
    findNodeByDeviceUID: (deviceUID: string) => TreeNode | undefined;
    findNodeByPath: (segments: PathSegment[]) => TreeNode | undefined;
    getNodePath: (node: TreeNode) => PathSegment[] | undefined;
    getTreeNodePath: (node: TreeNode) => TreeNode[] | undefined;
    findNodeParent: (node: TreeNode) => TreeNode | undefined;
}

const initialState = {
    nodes: [],
    selectedNode: undefined,
    selectedNodePath: undefined,
    isLoading: false,
    error: undefined,
    isReadOnly: false,
    isDtso: false,
};

export const useNodesStore = create<NodesState>((set, get) => ({
    ...initialState,

    setNodes: (nodes) =>
        set({ nodes, error: undefined }),

    selectNode: (selectedNode, options) => {
        if (!selectedNode) {
            set({ selectedNode: undefined, selectedNodePath: undefined });
            return;
        }
        const state = get();
        let updatedNodes = state.nodes;

        const path = findPathToNode(updatedNodes, selectedNode);

        if (path) {
            // Expand all nodes in the path except for the last one (the selected node itself)
            for (let index = 0; index < path.length - 1; index++) {
                const nodeInPath = path[index];
                if (!nodeInPath.expanded) {
                    updatedNodes = updateNodeInTree(updatedNodes, nodeInPath, n => ({ ...n, expanded: true }));
                }
            }
        }

        const selectedNodePath = path ? mapPathToSegments(path) : undefined;

        console.log('Node selected:', selectedNode, selectedNodePath);

        /**
         * Push to navigation history using the serialized PathSegment[] so every
         * node is uniquely tracked even when siblings share the same key.
         * Skip when navigating via back/forward to avoid corrupting the history stack.
         */
        if (selectedNodePath && !options?.skipHistory) {
            useNavigationHistoryStore.getState().push(JSON.stringify(selectedNodePath));
        }

        set({ selectedNode, selectedNodePath, nodes: updatedNodes, error: undefined });
    },

    selectNextNode: () => {
        const state = get();
        if (!state.selectedNode) {
            return;
        }
        const flatNodeList = getFlattenedNodes(state.nodes);
        const currentIndex = flatNodeList.indexOf(state.selectedNode);

        if (currentIndex !== -1 && currentIndex < flatNodeList.length - 1) {
            const nextNode = flatNodeList[currentIndex + 1];
            set({ selectedNode: nextNode });
        }
    },

    selectPreviousNode: () => {
        const state = get();
        if (!state.selectedNode) {
            return;
        }
        const flatNodeList = getFlattenedNodes(state.nodes);
        const currentIndex = flatNodeList.indexOf(state.selectedNode);

        if (currentIndex > 0) {
            const previousNode = flatNodeList[currentIndex - 1];
            set({ selectedNode: previousNode });
        }
    },

    setLoading: (isLoading) =>
        set({ isLoading }),

    setError: (error) =>
        set({ error, isLoading: false }),

    loadNodes: async () => {
        set({ isLoading: true, error: undefined });
        try {
            const vscodeStore = await useVscodeStore.getState();
            if (!vscodeStore.isConnected) {
                console.warn('VS Code API not initialized, using mock data for development');
                set({ nodes: [convertFormElementToTreeNode(mockData)], isLoading: false, error: undefined });
                return;
            }

            // Get device tree from backend using TreeView API
            console.log('Requesting device tree from backend');
            const response = await vscodeStore.sendRequest<GetDeviceTreeResponse>({
                command: TreeViewCommands.getDeviceTree
            } as GetDeviceTreeRequest);

            if (response.command === TreeViewCommands.getDeviceTree) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load device tree from backend';
                    console.error('Failed to load device tree:', errorMessage);
                    set({ nodes: [], isLoading: false, error: errorMessage });
                    return;
                }

                if (response.status === "success" && response.payload?.deviceTree) {
                    // Convert FormElement to TreeNode
                    const rootNode = convertFormElementToTreeNode(response.payload.deviceTree as FormObjectElement);
                    rootNode.expanded = true; // Expand root node by default
                    const nodes = [rootNode]; // Wrap in array since we expect TreeNode[]

                    const previousPath = get().selectedNodePath;
                    const restoredSelection = previousPath
                        ? resolvePathInTree(nodes, previousPath)
                        : undefined;

                    set({
                        nodes,
                        selectedNode: restoredSelection,
                        selectedNodePath: restoredSelection ? previousPath : undefined,
                        isLoading: false,
                        error: undefined,
                        isReadOnly: response.payload.isReadOnly,
                        isDtso: response.payload.isDtso
                    });
                    console.log('Device tree loaded from backend', response.payload);
                } else {
                    // No device tree returned
                    set({ nodes: [], isLoading: false, error: undefined });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load device tree from backend';
            console.error('Failed to load device tree:', error);
            set({ nodes: [], isLoading: false, error: errorMessage });
        }
    },
    initialize: async () => {
        // Auto-load nodes when store is initialized
        const state = get();
        if (state.nodes.length === 0 && !state.isLoading) {
            console.log('Initializing nodes store and loading nodes');
            await state.loadNodes();
        }
    },

    reset: () => set(initialState),

    // Tree-specific helper functions
    toggleNodeExpansion: (node: TreeNode) => {
        set(state => {
            const updatedNodes = updateNodeInTree(state.nodes, node, treeNode => ({
                ...treeNode,
                expanded: !(treeNode.expanded ?? true),
            }));

            // Update selectedNode if it's the one being expanded/collapsed
            const selectedNode = state.selectedNode === node
                ? { ...node, expanded: !(node.expanded ?? true) }
                : state.selectedNode;

            return { nodes: updatedNodes, selectedNode };
        });
    },

    setNodeExpansion: (node: TreeNode, expanded: boolean) => {
        set(state => {
            const updatedNodes = updateNodeInTree(state.nodes, node, treeNode => ({ ...treeNode, expanded }));

            // Update selectedNode if it's the one being modified
            const selectedNode = state.selectedNode === node
                ? { ...node, expanded }
                : state.selectedNode;

            return { nodes: updatedNodes, selectedNode };
        });
    },

    updateNode: (node: TreeNode, updates: Partial<TreeNode>) => {
        set(state => {
            const updatedNodes = updateNodeInTree(state.nodes, node, treeNode => ({ ...treeNode, ...updates }));

            // Update selectedNode if it's the one being modified
            const selectedNode = state.selectedNode === node
                ? { ...node, ...updates }
                : state.selectedNode;

            return { nodes: updatedNodes, selectedNode };
        });
    },

    deleteNode: (node: TreeNode) => {
        // TODO: implement with backend
        // For now, just clear selection if deleting the selected node
        const state = get();
        if (state.selectedNode === node) {
            set({ selectedNode: undefined, selectedNodePath: undefined });
        }
    },

    findNodeByDeviceUID: (deviceUID: string): TreeNode | undefined => {
        const state = get();

        const findInNodes = (nodes: TreeNode[]): TreeNode | undefined => {
            for (const node of nodes) {
                if ((node.data as FormObjectElement).deviceUID === deviceUID) {
                    return node;
                }
                if (node.children) {
                    const found = findInNodes(node.children);
                    if (found) { return found; }
                }
            }
            return undefined;
        };

        return findInNodes(state.nodes);
    },
    
    findNodeByPath: (segments: PathSegment[]): TreeNode | undefined => {
        const state = get();
        return resolvePathInTree(state.nodes, segments);
    },

    getNodePath: (target: TreeNode): PathSegment[] | undefined => {
        const state = get();
        const path = findPathToNode(state.nodes, target);
        return path ? mapPathToSegments(path) : undefined;
    },

    getTreeNodePath: (target: TreeNode): TreeNode[] | undefined => {
        const state = get();
        return findPathToNode(state.nodes, target);
    },

    findNodeParent: (targetNode: TreeNode): TreeNode | undefined => {
        const state = get();
        const findParent = (nodes: TreeNode[], parent?: TreeNode): TreeNode | undefined => {
            for (const node of nodes) {
                if (node === targetNode) {
                    return parent;
                }
                if (node.children) {
                    const foundParent = findParent(node.children, node);
                    if (foundParent) {
                        return foundParent;
                    }
                }
            }
            return undefined;
        };
        return findParent(state.nodes);
    },
}));
