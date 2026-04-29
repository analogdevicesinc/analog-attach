import { useNodesStore } from "@/store/useNodesStore";
import styles from './Breadcrumb.module.scss';
import { TreeNode } from "@/types";
import { useMemo, useState } from "react";
import { Popup, VscodeButton, VscodeIcon } from "hds-react";

export function Breadcrumb({ truncationLimit, disableNavigation }: { truncationLimit?: number, disableNavigation?: boolean }) {
    const { selectNode, selectedNode, getTreeNodePath } = useNodesStore();

    const pathNodes = useMemo(() => {
        if (!selectedNode) {
            return [];
        }
        return getTreeNodePath(selectedNode) ?? [];
    }, [selectedNode, getTreeNodePath]);

    const handleNodeClick = (node: TreeNode) => {
        selectNode(node);
    };

    const shouldTruncate = truncationLimit && pathNodes.length > truncationLimit + 1;
    const lastNodeIndex = pathNodes.length - 1;
    const firstVisibleNodeAfterTruncation = shouldTruncate ? lastNodeIndex - (truncationLimit - 2) : 0;

    return (
        <div className={styles.breadcrumb} aria-disabled={disableNavigation}>
            {pathNodes.map((pathNode, index) => {
                if (shouldTruncate && index > 0 && index < firstVisibleNodeAfterTruncation) {
                    if (index === 1) { // Show only one ellipsis
                        return (
                            <span key="ellipsis">
                                <span className={styles.pathSeparator}>/</span>
                                <TruncatedNodes nodes={pathNodes.slice(1, firstVisibleNodeAfterTruncation)} onSelect={disableNavigation ? undefined : handleNodeClick} />
                            </span>
                        );
                    }
                    return null; // Hide other truncated nodes
                }

                return (
                    <span key={pathNode.label}>
                        {index > 0 && (
                            <span className={styles.pathSeparator} aria-disabled={disableNavigation}>
                                /
                            </span>
                        )}
                        {index === lastNodeIndex ? (
                            <span className={styles.currentNode}>
                                {pathNode.label}
                            </span>
                        ) : (
                            <button
                                className={styles.pathButton}
                                onClick={() => handleNodeClick(pathNode)}
                                disabled={disableNavigation}
                            >
                                {pathNode.label}
                            </button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}


function TruncatedNodes({ nodes, onSelect }: { nodes: TreeNode[], onSelect?: (node: TreeNode) => void }) {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (node: TreeNode) => {
        if (onSelect) {
            onSelect(node);
        }
        setIsOpen(false);
    };

    return (
        <Popup isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <VscodeButton
                slot="trigger"
                onClick={() => setIsOpen((prev) => !prev)}
                className={styles.truncateButton}
            >
                <VscodeIcon name="ellipsis" />
            </VscodeButton>
            <ul className={styles.popupMenu}>
                {nodes.map((node, index) => (
                    <li key={index} className={styles.popupMenuItem}>
                        {index > 0 && (
                            <span className={styles.pathSeparator}>
                                /
                            </span>
                        )}
                        <button
                            className={styles.pathButton}
                            onClick={() => handleSelect(node)}
                            disabled={!onSelect}
                        >
                            {node.label}
                        </button>
                    </li>
                ))}
            </ul>
        </Popup>
    );
}
