import { VscodeTextfield, VscodeRadio, VscodeButton, VscodeIcon } from "hds-react";
import styles from './AddNode.module.scss';
import { Breadcrumb } from "../breadcrumb/Breadcrumb";
import { useState, useRef, useLayoutEffect, useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useUIStore } from "@/store/useUIStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import { useNodesStore } from "@/store/useNodesStore";
import { ChannelNameInput, useVscodeStore } from "attach-ui-lib";
import ErrorDisplay from "../components/ErrorDisplay";
import { DeviceCommands, type CatalogDevice, type SetParentNodeResponse, type FormObjectElement } from "extension-protocol";
import { useDeviceConfigurationStore } from "@/store/useDeviceConfigurationStore";

interface NodeTemplate extends CatalogDevice {
    showMore: boolean;
}

interface NodeTemplateItemProps {
    template: NodeTemplate;
    isSelected: boolean;
    onSelect: () => void;
    onMeasure?: () => void;
}

function NodeTemplateItem({ template, isSelected, onSelect, onMeasure }: NodeTemplateItemProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Trigger remeasurement when expansion state changes
    useLayoutEffect(() => {
        if (onMeasure) {
            // Use requestAnimationFrame to ensure DOM has updated after state change
            requestAnimationFrame(() => {
                onMeasure();
            });
        }
    }, [isExpanded, onMeasure]);

    const toggleExpansion = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        setIsExpanded(!isExpanded);
    };

    const description = isExpanded ? template.description : template.description.slice(0, 100) + (template.description.length > 100 ? '...' : '');

    return (
        <div className={styles.nodeItem} onClick={onSelect}>
            <VscodeRadio name="node-template" value={template.deviceId} className={styles.radio} checked={isSelected} onInput={onSelect} />
            <div className={styles.nodeInfo}>
                <div className={styles.nodeName}>{template.name}</div>
                <div className={styles.nodeDescription}>{description}</div>
                {template.showMore && (
                    <a href="#" onClick={toggleExpansion} className={styles.showMore}>
                        {isExpanded ? 'Show Less' : 'Show More'}
                    </a>
                )}
            </div>
        </div>
    );
}

function CustomNodeTemplate({
    isSelected,
    onSelect,
    customNodeName,
    onCustomNodeNameChange
}: {
    isSelected: boolean;
    onSelect: () => void;
    customNodeName: string;
    onCustomNodeNameChange: (name: string) => void;
}) {
    return (
        <div className={styles.nodeItem} onClick={onSelect}>
            <VscodeRadio name="node-template" value="custom" className={styles.radio} checked={isSelected} onInput={onSelect} />
            <div className={styles.nodeInfo}>
                <div className={styles.nodeName}>Custom</div>
                <div className={styles.nodeDescription}>Custom node name</div>
                {isSelected && (
                    <VscodeTextfield
                        placeholder="Start typing..."
                        className={styles.customNodeInput}
                        value={customNodeName}
                        onInput={(e) => onCustomNodeNameChange((e.target as HTMLInputElement).value)}
                    />
                )}
            </div>
        </div>
    );
}

function ChannelNodeTemplate({
    isSelected,
    onSelect,
    channelRegexes,
    generatedChannelNames,
    onChannelSubmit
}: {
    isSelected: boolean;
    onSelect: () => void;
    channelRegexes: string[];
    generatedChannelNames?: string[];
    onChannelSubmit: (channelName: string, isValid: boolean) => void;
}) {
    const [localChannelName, setLocalChannelName] = useState('');

    const handleChannelNameChange = (value: string, isValid: boolean) => {
        setLocalChannelName(value);
        onChannelSubmit(value, isValid);
    };

    return (
        <div className={styles.nodeItem} onClick={onSelect}>
            <VscodeRadio name="node-template" value="channel" className={styles.radio} checked={isSelected} onInput={onSelect} />
            <div className={styles.nodeInfo}>
                <div className={styles.nodeName}>Channel</div>
                <div className={styles.nodeDescription}>Add a channel to the parent node</div>
                {isSelected && (
                    <ChannelNameInput
                        channelRegexes={channelRegexes}
                        generatedChannelNames={generatedChannelNames}
                        value={localChannelName}
                        onChange={handleChannelNameChange}
                    />
                )}
            </div>
        </div>
    );
}


export function AddNodeCard() {
    const { setView, setExpandedNode } = useUIStore();
    const { devices, isLoading, error } = useCatalogStore();
    const { selectedNode, loadNodes, findNodeByDeviceUID, selectNode } = useNodesStore();
    const { getConfiguration, configuration } = useDeviceConfigurationStore();
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [customNodeName, setCustomNodeName] = useState('');
    const [channelName, setChannelName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | undefined>(undefined);

    const [invalidChannelName, setInvalidChannelName] = useState(false);
    const parentRef = useRef<HTMLDivElement>(null);
    const listContainerRef = useRef<HTMLDivElement>(null);

    const parentNodeId = (selectedNode?.data as FormObjectElement | undefined)?.deviceUID;
    const parentNodeKey = (selectedNode?.data as FormObjectElement | undefined)?.key;
    const deviceUID = (selectedNode?.data as FormObjectElement | undefined)?.deviceUID;

    const nodeTemplates: NodeTemplate[] = devices.map(device => ({
        ...device,
        showMore: device.description.length > 100
    }));

    // Fetch configuration when deviceUID changes
    useEffect(() => {
        if (deviceUID) {
            getConfiguration(deviceUID);
        }
    }, [deviceUID, getConfiguration]);

    // Check if the device supports channels
    const supportsChannels = (configuration?.channelRegexes?.length ?? 0) > 0;
    const channelRegexes = configuration?.channelRegexes || [];
    const generatedChannelNames = configuration?.generatedChannelRegexEntries || [];

    const filteredTemplates = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return nodeTemplates;
        return nodeTemplates.filter(t =>
            t.name.toLowerCase().includes(query) ||
            t.description.toLowerCase().includes(query)
        );
    }, [nodeTemplates, searchQuery]);

    // Clear selection if the selected template is filtered out (but not for 'custom')
    useEffect(() => {
        if (
            selectedTemplate &&
            selectedTemplate !== 'custom' &&
            selectedTemplate !== 'channel' &&
            !filteredTemplates.some(t => t.deviceId === selectedTemplate)
        ) {
            setSelectedTemplate(null);
        }
    }, [filteredTemplates, selectedTemplate]);

    // Store container element refs for remeasurement
    const containerRefs = useRef<Map<number, HTMLElement>>(new Map());

    const virtualizer = useVirtualizer({
        count: filteredTemplates.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 80,
        overscan: 5,
        scrollMargin: listContainerRef.current?.offsetTop ?? 0,
        measureElement: (element) => {
            // Measure element including margins (getBoundingClientRect includes margins)
            return element.getBoundingClientRect().height;
        },
    });

    const handleChannelSubmit = (name: string, isValid: boolean) => {
        setChannelName(name);
        setInvalidChannelName(!isValid);
    };

    const handleContinue = async () => {
        if (selectedTemplate === undefined) return;
        if (parentNodeId === undefined || parentNodeKey === undefined) {
            setSubmitError('Select a parent node that has a device UID before adding a child.');
            return;
        }

        // Validate custom node name when custom is selected
        if (selectedTemplate === 'custom' && !customNodeName.trim()) return;

        // Validate channel name when channel is selected
        if (selectedTemplate === 'channel' && invalidChannelName) {
            setSubmitError('Please provide a valid channel name');
            return;
        }

        setIsSubmitting(true);
        setSubmitError(undefined);

        try {
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, cannot set parent node');
                return;
            }

            // Handle channel template differently - add channel to device configuration
            if (selectedTemplate === 'channel') {
                // Get current device configuration
                const { getConfiguration, configuration, updateConfiguration } = useDeviceConfigurationStore.getState();
                
                if (!configuration) {
                    await getConfiguration(parentNodeId);
                    const updatedConfig = useDeviceConfigurationStore.getState().configuration;
                    if (!updatedConfig) {
                        setSubmitError('Failed to load device configuration');
                        setIsSubmitting(false);
                        return;
                    }
                }

                const currentConfig = useDeviceConfigurationStore.getState().configuration;
                if (!currentConfig) {
                    setSubmitError('Failed to load device configuration');
                    setIsSubmitting(false);
                    return;
                }

                // Create new channel FormObjectElement
                const newChannel: FormObjectElement = {
                    type: 'FormObject',
                    key: channelName.trim(),
                    channelName: channelName.trim(),
                    required: false,
                    config: []
                };

                // Add channel to config array
                const updatedConfig = {
                    ...currentConfig,
                    config: [...currentConfig.config, newChannel]
                };

                // Update device configuration
                await updateConfiguration(parentNodeId, updatedConfig);

                // Reload nodes and expand
                await loadNodes();
                setExpandedNode(parentNodeKey, true);

                setView('config');
                return;
            }

            // Handle regular node templates
            const deviceId = selectedTemplate === 'custom'
                ? customNodeName.trim()
                : selectedTemplate;

            const response = await useVscodeStore.getState().sendRequest<SetParentNodeResponse>({
                command: DeviceCommands.setParentNode,
                payload: {
                    deviceId,
                    parentNode: {
                        uuid: parentNodeId,
                        name: parentNodeKey,
                    },
                },
            });

            if (response.status === 'error') {
                setSubmitError(response.error?.message || 'Failed to add node');
                setIsSubmitting(false);
                return;
            }

            await loadNodes();
            setExpandedNode(parentNodeKey, true);

            // Select the newly added node to scroll it into view
            const newNodeUID = response.payload.deviceUID;
            const newNode = findNodeByDeviceUID(newNodeUID);
            if (newNode) {
                selectNode(newNode);
            }

            setView('config');
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to add node');
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.centerContainer}>
                <div className={styles.header}>
                    <header className={`${styles.centered}`}>
                        <Breadcrumb truncationLimit={8} disableNavigation />
                        <h1 className={styles.title}>Add a Child Node</h1>
                    </header>

                    <div className={`${styles.searchSection} ${styles.centered}`}>
                        <VscodeTextfield
                            placeholder="Search"
                            className={styles.searchBar}
                            value={searchQuery}
                            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                        >
                            <VscodeIcon
                                slot="content-before"
                                name="search"
                                title="search"
                            ></VscodeIcon>
                            <span slot="content-after" className={styles.availableCount}>{filteredTemplates.length} available</span>
                        </VscodeTextfield>
                    </div>
                    
                    {error && <ErrorDisplay message={error} />}
                    {submitError && <ErrorDisplay message={submitError} />}
                </div>

                <div ref={parentRef} className={styles.nodeListContainer}>
                    <div className={styles.centered}>
                        {supportsChannels && (
                            <ChannelNodeTemplate
                                isSelected={selectedTemplate === 'channel'}
                                onSelect={() => setSelectedTemplate('channel')}
                                channelRegexes={channelRegexes}
                                generatedChannelNames={generatedChannelNames}
                                onChannelSubmit={handleChannelSubmit}
                            />
                        )}
                        <CustomNodeTemplate
                            isSelected={selectedTemplate === 'custom'}
                            onSelect={() => setSelectedTemplate('custom')}
                            customNodeName={customNodeName}
                            onCustomNodeNameChange={setCustomNodeName}
                        />
                        {isLoading && <div>Loading devices...</div>}
                    </div>
                    <div
                        ref={listContainerRef}
                        className={styles.centered}
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualItem) => {
                            const template = filteredTemplates[virtualItem.index];
                            return (
                                <div
                                    key={virtualItem.key}
                                    data-index={virtualItem.index}
                                    ref={(el) => {
                                        if (el) {
                                            containerRefs.current.set(virtualItem.index, el);
                                            // Register element with virtualizer for measurement
                                            virtualizer.measureElement(el);
                                        } else {
                                            containerRefs.current.delete(virtualItem.index);
                                        }
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
                                    }}
                                >
                                    <NodeTemplateItem
                                        template={template}
                                        isSelected={selectedTemplate === template.deviceId}
                                        onSelect={() => setSelectedTemplate(template.deviceId)}
                                        onMeasure={() => {
                                            // Trigger remeasurement when item expands/collapses
                                            const containerElement = containerRefs.current.get(virtualItem.index);
                                            if (containerElement) {
                                                virtualizer.measureElement(containerElement);
                                            }
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <footer className={styles.footer}>
                <div className={styles.footerContainer}>
                    <VscodeButton variant="secondary" size="large" onClick={() => setView('config')}>Cancel</VscodeButton>
                    <VscodeButton
                        size="large"
                        onClick={handleContinue}
                        variant="primary"
                        disabled={
                            !selectedTemplate ||
                            (selectedTemplate === 'custom' && !customNodeName.trim()) ||
                            (selectedTemplate === 'channel' && !channelName.trim()) ||
                            !parentNodeId ||
                            isSubmitting
                        }
                    >
                        {isSubmitting ? 'Adding...' : 'Continue'}
                    </VscodeButton>
                </div>
            </footer>
        </div>
    );
}
