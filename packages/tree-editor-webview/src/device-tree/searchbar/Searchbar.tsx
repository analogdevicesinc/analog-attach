import { VscodeIcon, VscodeTextfield } from "hds-react";
import { memo, useState, useMemo } from "react";
import styles from './Searchbar.module.scss';
import { useNodesStore } from "@/store/useNodesStore";
import { SearchResult, containsSearch } from "./helpers";
import { TreeNode } from "@/types";


function Searchbar() {
    const [query, setQuery] = useState('');
    const { nodes, selectNode } = useNodesStore();

    // flatten the tree nodes with their full paths recursively
    const flattenedNodes = useMemo(() => {
        const flattenWithPath = (nodeList: TreeNode[], path: string[] = []): Array<{ node: TreeNode; path: string }> => {
            const result: Array<{ node: TreeNode; path: string }> = [];

            for (const node of nodeList) {
                const currentPath = [...path, node.label];
                const pathString = currentPath.join(' / ');
                result.push({ node, path: pathString });

                if (node.children && node.children.length > 0) {
                    result.push(...flattenWithPath(node.children, currentPath));
                }
            }

            return result;
        };

        return flattenWithPath(nodes);
    }, [nodes]);

    const searchResults = useMemo(() => {
        if (!query) return [];

        return flattenedNodes
            .map(({ node, path }) => ({
                node,
                path,
                searchResult: containsSearch(path, query)
            }))
            .filter(item => item.searchResult.match);
    }, [query, flattenedNodes]);

    // also used in pnp-webview
    const highlightMatches = (name: string, searchResult: SearchResult | undefined) => {
        if (!searchResult || !searchResult.match) {
            return name;
        }
        const { ranges } = searchResult;
        const parts = [];
        let lastIndex = 0;
        for (const [start, end] of ranges) {
            if (start > lastIndex) {
                parts.push(name.substring(lastIndex, start));
            }
            parts.push(<mark className={styles.highlight} key={start}>{name.substring(start, end)}</mark>);
            lastIndex = end;
        }
        if (lastIndex < name.length) {
            parts.push(name.substring(lastIndex));
        }
        return parts;
    };

    const handleSelectResult = (node: TreeNode) => {
        selectNode(node);
        setQuery('');
    };

    return (
        <div style={{ position: 'relative', width: '100%' }}>
            <VscodeTextfield
                placeholder="Search"
                className={styles.searchbar}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                value={query}
            >
                <VscodeIcon
                    slot="content-before"
                    name="search"
                    title="search"
                ></VscodeIcon>
            </VscodeTextfield>

            {query.length > 0 && (
                <div className={styles.searchResultsPopup}>
                    {searchResults.length > 0 ? (
                        searchResults.map(({ node, path, searchResult }, index) => (
                            <button
                                key={index}
                                className={styles.searchResultItem}
                                onClick={() => handleSelectResult(node)}
                            >
                                {highlightMatches(path, searchResult)}
                            </button>
                        ))
                    ) : (
                        <div className={styles.noResults}>No results found</div>
                    )}
                </div>
            )}
        </div>
    );
}

export default memo(Searchbar);