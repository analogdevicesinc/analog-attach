/**
 *
 * Copyright (c) 2025 Analog Devices, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
import { memo, useEffect, useState } from 'react';
import PnpNavigation from '../pnp-navigation/PnpNavigation';
import { useDeviceStore } from '../../store';
import DeviceParentSelection from '../device-parent-selection/DeviceParentSelection';
import { VscodeProgressRing } from 'hds-react';
import styles from './PnpDeviceList.module.scss';

/**
 * Pure presentational component that displays device groups from Zustand store.
 * The store handles loading automatically.
 */
function PnpDeviceList() {
    const { deviceGroups, isLoading, error } = useDeviceStore();

    const [connectingNode, setConnectingNode] = useState<string | undefined>();
    const resetConnectingNode = () => setConnectingNode(undefined);

    // Load devices on mount if not already loaded
    useEffect(() => {
        const store = useDeviceStore.getState();
        console.log('PnpDeviceList: Checking store, current deviceGroups:', store.deviceGroups);
        if (store.deviceGroups.length === 0 && !store.isLoading) {
            console.log('PnpDeviceList: Loading devices...');
            void store.loadDevices();
        }
    }, []);

    useEffect(() => {
        console.log('PnpDeviceList: deviceGroups changed:', deviceGroups);
    }, [deviceGroups]);

    if (isLoading) {
        return (
            <div className={styles.loadingContainer}>
                <VscodeProgressRing />
                <span className={styles.loadingText}>Loading devices...</span>
            </div>
        );
    }

    if (error) {
        return <div>Error loading devices: {error}</div>;
    }

    if (deviceGroups.length === 0) {
        return <div>No devices available</div>;
    }

    return (

        <div style={{ height: '100%', width: '100%' }}>
            {!connectingNode && <PnpNavigation deviceGroups={deviceGroups} onConnectNode={setConnectingNode} />}
            {connectingNode && <DeviceParentSelection onFinish={resetConnectingNode} connectingNode={connectingNode} />}
        </div>

    );
}

export default memo(PnpDeviceList);
