import { TreeNode } from '@/types';
import styles from './Tree.module.scss';
import { Tooltip, VscodeIcon } from 'hds-react';
import { useNodesStore } from '@/store/useNodesStore';
import { useEffect, useRef } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { GhostButton } from 'attach-ui-lib';
import { FormObjectElement } from 'extension-protocol';


export default function Tree() {
    const { nodes } = useNodesStore();

    return (
        <div className={styles.tree}>
            {nodes.map((rootNode, index) => (
                <TreeItem
                    key={index}
                    node={rootNode}
                    level={0}
                    isRoot={true}
                />
            ))}
        </div>
    );
}

interface TreeItemProps {
    node: TreeNode;
    level: number;
    isRoot?: boolean;
}

function TreeItem({ node, level, isRoot = false }: TreeItemProps) {
    const { selectedNode, selectNode, toggleNodeExpansion, selectNextNode, selectPreviousNode, findNodeParent, setNodeExpansion } = useNodesStore();
    const { setView, setExpandedNode, expandedNodes } = useUIStore();
    const itemRef = useRef<HTMLDivElement>(null);

    // Get current node state from store (in case it was updated)
    const formObjectData = node.data as FormObjectElement;
    const isExpanded = node.expanded || expandedNodes.has(formObjectData.deviceUID!);

    const isParentActive =  (findNodeParent(node)?.data as FormObjectElement)?.active;
    
    const isSelected = selectedNode ? selectedNode.data == node.data : false;
    const hasChildren = node.children && node.children.length > 0;

    const hasUID = formObjectData.deviceUID;
    const toggleExpanded = () => {
        if (hasChildren) {
            toggleNodeExpansion(node);
            setExpandedNode(formObjectData.deviceUID!, !isExpanded); // Update UI state for expanded nodes
        }
    };

    const handleSelect = () => {
        selectNode(node);
        setNodeExpansion(node, true); // Ensure node is expanded when selected
        setExpandedNode(formObjectData.deviceUID!, true); // For UI state that may be used by other components
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        switch (event.key) {
            case 'Enter':
            case ' ':
                event.preventDefault();
                handleSelect();
                break;
            case 'ArrowRight':
                if (hasChildren && !isExpanded) {
                    toggleExpanded();
                }
                break;
            case 'ArrowLeft':
                if (hasChildren && isExpanded) {
                    toggleExpanded();
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                selectPreviousNode();
                break;
            case 'ArrowDown':
                event.preventDefault();
                selectNextNode();
                break;
        }
    };

    useEffect(() => {
        if (isSelected && itemRef.current) {
            // Delay scroll to next frame to ensure DOM layout is complete
            requestAnimationFrame(() => {
                const element = itemRef.current;
                if (!element) return;

                // Find the vscode-scrollable ancestor
                const scrollable = element.closest('vscode-scrollable') as HTMLElement & { scrollPos: number; scrollMax: number } | null;
                if (!scrollable) {
                    // Fallback to native scrollIntoView
                    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    return;
                }

                // Calculate the element's position relative to the scrollable container
                const scrollableRect = scrollable.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();

                // Check if element is above the visible area
                if (elementRect.top < scrollableRect.top) {
                    const offset = elementRect.top - scrollableRect.top;
                    scrollable.scrollPos = Math.max(0, scrollable.scrollPos + offset);
                }
                // Check if element is below the visible area
                else if (elementRect.bottom > scrollableRect.bottom) {
                    const offset = elementRect.bottom - scrollableRect.bottom;
                    scrollable.scrollPos = Math.min(scrollable.scrollMax, scrollable.scrollPos + offset);
                }
            });
        }
    }, [isSelected]);


    return (
        <div className={`${styles.treeItem} ${isRoot ? styles.rootItem : ''}`} ref={itemRef} style={{ opacity: (isParentActive && formObjectData.active) === false ? 0.8 : 1 }}>
            <div
                className={`${styles.treeItemContent} ${isSelected ? styles.selected : ''}`}
                tabIndex={0}
                onKeyDown={handleKeyDown}
            >
                {hasChildren ? (
                    <GhostButton
                        onClick={toggleExpanded}
                        disabled={!hasChildren}
                        icon={isExpanded ? 'chevron-down' : 'chevron-right'}
                        hidden={!hasChildren}
                        className={styles.expandButton}
                    >
                    </GhostButton>
                ) : (
                    <span style={{ width: '6px', display: 'inline-block' }}></span>
                )}

                <span onClick={handleSelect} title={isParentActive === false ? "Parent is inactive" : undefined} className={styles.treeItemLabel}>{isSelected ? selectedNode!.label : node.label}</span>

                <div className={styles.treeItemActions}>

                    {node.hasErrors && (
                        <Tooltip label="This node has errors" position='bottom'>
                            <VscodeIcon name="error" className={styles.errorIcon} />
                        </Tooltip>
                    )}

                    {(node.data as FormObjectElement).active === false && (
                        <Tooltip label="This node is disabled" position='bottom'>
                            <VscodeIcon name="circle-slash" className={styles.disabledIcon} />
                        </Tooltip>
                    )}

                    {hasUID && <Tooltip label="Add Child Node" position="bottom">
                        <GhostButton
                            icon='add'
                            className={styles.addNodeButton}
                            onClick={() => {
                                selectNode(node);
                                setView('add-node');
                            }}
                        />
                    </Tooltip>}
                </div>
            </div>

            {/* Children */}
            {hasChildren && isExpanded && (
                <div className={styles.treeItemChildren}>
                    {node.children!.map((child, index) => (
                        <TreeItem
                            key={index}
                            node={child}
                            level={level + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}