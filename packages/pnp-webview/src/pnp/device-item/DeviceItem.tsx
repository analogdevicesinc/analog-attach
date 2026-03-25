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
import { Tooltip } from 'hds-react';
import { GhostButton } from 'attach-ui-lib';
import { memo } from 'react';
import styles from './DeviceItem.module.scss';

type DeviceItemProperties = Readonly<{
    name: string | React.ReactNode;
    onConnectNode: (node: string) => void;
    hasParent?: boolean;
    originalName: string;
}>;

function DeviceItem({ name, onConnectNode, hasParent, originalName }: DeviceItemProperties) {
    const clickHandler = () => {
        onConnectNode(originalName);
    };
    
    return (
        <div
            className={styles.deviceItemContainer}
            data-test={`device-item:${originalName}`}
        >
            <div className={hasParent ? styles.nestedDeviceItemContainer : styles.flatDeviceItemContainer}>
                <div className={styles.deviceContent}>
                    <div className={styles.deviceName}>{name}</div>
                </div>
                <div>
                    <Tooltip 
                        label="Connect" 
                        position="bottom"
                    >
                        <GhostButton 
                            className={styles.editorBGButton} 
                            icon='add' 
                            onClick={clickHandler} 
                        />
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

export default memo(DeviceItem);