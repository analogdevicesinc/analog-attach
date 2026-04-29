import { TreeNode } from '@/types';
import { create } from 'zustand';

type View = 'config' | 'add-node';

interface UIState {
    // State
    view: View;
    expandedNodes: Set<string>;
    deviceToDelete?: TreeNode;

    // Actions
    setView: (view: View) => void;
    setExpandedNode: (nodeId: string, expanded: boolean) => void;
    setDeviceToDelete: (device: TreeNode | undefined) => void;
    reset: () => void;
}

const initialState = {
    view: 'config' as View,
    expandedNodes: new Set<string>(),
};

export const useUIStore = create<UIState>((set) => ({
    ...initialState,

    setExpandedNode(nodeId: string, expanded: boolean) {
        set((state) => {
            const newExpanded = new Set(state.expandedNodes);
            if (expanded) {
                newExpanded.add(nodeId);
            } else {
                newExpanded.delete(nodeId);
            }
            return { expandedNodes: newExpanded };
        });
    },

    setView: (view) => set({ view }),

    setDeviceToDelete: (device: TreeNode | undefined) => set({ deviceToDelete: device }),

    reset: () => set(initialState),
}));
