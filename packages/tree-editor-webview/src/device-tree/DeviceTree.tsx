import { useEffect, useCallback } from 'react';
import { VscodeScrollable } from 'hds-react';
import { useNodesStore } from '@/store/useNodesStore';
import { useCatalogStore } from '@/store/useCatalogStore';
import Tree from './tree/Tree';
import ConfigView from './config-view/ConfigView';
import styles from './DeviceTree.module.scss';
import { AddNodeCard } from './add-node/AddNode';
import { useUIStore } from '@/store/useUIStore';
import { Allotment } from 'allotment';
import Searchbar from './searchbar/Searchbar';
import { DeleteSensorModal, NavigationBar, useVscodeStore } from 'attach-ui-lib';
import { DeleteDeviceRequest, DeleteDeviceResponse, DeviceCommands, EventCommands, NavigationCommands, FormObjectElement } from 'extension-protocol';
import { useDeviceConfigurationStore } from '@/store/useDeviceConfigurationStore';
import { useNavigationHistoryStore } from '@/store/useNavigationHistoryStore';
import type { PathSegment } from '@/types';

function DeviceTree() {
  const { nodes, error, initialize, loadNodes, selectedNode, selectNode } = useNodesStore();
  const clearConfiguration = useDeviceConfigurationStore(state => state.clearConfiguration);
  const { view, deviceToDelete, setDeviceToDelete } = useUIStore();
  const { loadDevices } = useCatalogStore();
  const { isConnected, onMessage } = useVscodeStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    // Preload catalog devices in the background once connection is ready
    if (isConnected) {
      loadDevices();
      loadNodes();
    }
  }, [isConnected, loadDevices, loadNodes]);

  /**
   * Try to resolve a serialised PathSegment[] to a tree node and select it.
   * Returns true if the entry was resolved successfully, false otherwise.
   */
  const tryNavigateToEntry = useCallback((serialisedPath: string): boolean => {
    const segments: PathSegment[] = JSON.parse(serialisedPath);
    const node = useNodesStore.getState().findNodeByPath(segments);
    if (node) {
      useNodesStore.getState().selectNode(node, { skipHistory: true });
      return true;
    }
    return false;
  }, []);

  const handleNavigateBack = useCallback(() => {
    // Skip entries that can no longer be resolved (e.g. deleted nodes)
    let entry = useNavigationHistoryStore.getState().goBack();
    while (entry && !tryNavigateToEntry(entry)) {
      entry = useNavigationHistoryStore.getState().goBack();
    }
  }, [tryNavigateToEntry]);

  const handleNavigateForward = useCallback(() => {
    // Skip entries that can no longer be resolved (e.g. deleted nodes)
    let entry = useNavigationHistoryStore.getState().goForward();
    while (entry && !tryNavigateToEntry(entry)) {
      entry = useNavigationHistoryStore.getState().goForward();
    }
  }, [tryNavigateToEntry]);

  // Re-read from store so React re-renders when history changes
  const historyIndex = useNavigationHistoryStore(s => s.currentIndex);
  const historyLength = useNavigationHistoryStore(s => s.history.length);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyLength - 1;

  // Refresh tree when backend reloads the file or pushes a fresh tree response
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      // Accept spec-compliant notifications (command) and legacy bare type messages
      const isFileReload = data?.command === EventCommands.fileChanged;
      if (isFileReload) {
        void (async () => {
          await loadNodes();                 // store will try to restore selection by label
          const freshSelected = useNodesStore.getState().selectedNode;
          const deviceUID = (freshSelected?.data as FormObjectElement | undefined)?.deviceUID;
          if (deviceUID) {
            await useDeviceConfigurationStore.getState().getConfiguration(deviceUID);
          } else {
            clearConfiguration();            // clear config tied to stale deviceUID
          }
        })();
      }

      // Handle navigation commands from the extension host
      if (data?.command === NavigationCommands.navigateBack) {
        handleNavigateBack();
      }
      if (data?.command === NavigationCommands.navigateForward) {
        handleNavigateForward();
      }
    };

    const unsubscribe = onMessage(handleMessage);
    return () => unsubscribe();
  }, [loadNodes, clearConfiguration, onMessage, handleNavigateBack, handleNavigateForward]);

  const handleCloseDeleteModal = () => {
    setDeviceToDelete(undefined);
  }

  const handleConfirmDelete = async () => {
    if (!deviceToDelete) return;

    const vscodeStore = useVscodeStore.getState();
    const deviceUID = (deviceToDelete.data as FormObjectElement).deviceUID;

    if (!deviceUID) return; // return if the node cannot be deleted

    // Remove the deleted node (and any of its descendants) from navigation history.
    // Match any entry whose path passes through the deleted node (identified by uid).
    // Using uid directly avoids relying on getNodePath which can fail when the
    // selectedNode object reference has diverged from the tree (e.g. after
    // setNodeExpansion creates a new object).
    useNavigationHistoryStore.getState().remove((entry: string) => {
      const entrySegments: PathSegment[] = JSON.parse(entry);
      return entrySegments.some(seg => seg.uid === deviceUID);
    });

    await vscodeStore.sendRequest<DeleteDeviceResponse>({
      command: DeviceCommands.delete,
      payload: { deviceUID }
    } as DeleteDeviceRequest);

    // deselect current node if it has been deleted
    if (deviceUID === (selectedNode?.data as FormObjectElement).deviceUID) {
      selectNode(undefined);
    }

    // reload nodes
    await loadNodes();
    const freshSelected = useNodesStore.getState().selectedNode;
    const freshDeviceUID = (freshSelected?.data as FormObjectElement | undefined)?.deviceUID;
    if (freshDeviceUID) {
      await useDeviceConfigurationStore.getState().getConfiguration(freshDeviceUID);
    } else {
      clearConfiguration();
    }
    setDeviceToDelete(undefined);
  }

  if (error && nodes.length === 0) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        <div>Error loading tree: {error}</div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={{ padding: '20px' }}>
        <div>No tree data available</div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {deviceToDelete &&
        <DeleteSensorModal
          isOpen={!!deviceToDelete}
          onClose={handleCloseDeleteModal}
          onDelete={handleConfirmDelete}
          sensorName={deviceToDelete?.data.key || ''}
          sensorAlias={(deviceToDelete?.data as FormObjectElement).alias || ''}
        />
      }
      <NavigationBar
        title="Analog Attach - Advanced Device Tree Editor"
        onNavigateBack={handleNavigateBack}
        onNavigateForward={handleNavigateForward}
        canNavigateBack={canGoBack}
        canNavigateForward={canGoForward}
      />

      {view === 'add-node' ? <AddNodeCard /> : (
        <Allotment>
          <Allotment.Pane preferredSize={300} minSize={240} className={styles.leftPane}>
            <div className={styles.searchContainer}>
              <Searchbar />
            </div>

            <VscodeScrollable className={styles.deviceTreeContainer}>
              <Tree />
            </VscodeScrollable>
          </Allotment.Pane>

          <Allotment.Pane minSize={360}>
            <ConfigView />
          </Allotment.Pane>
        </Allotment>
      )}
    </div>
  );
}

export default DeviceTree;
