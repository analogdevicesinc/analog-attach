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
import { memo, useCallback, useState, useEffect } from 'react';
import Accordion from '../accordion/Accordion';
import styles from './DeviceGroup.module.scss';

type DeviceGroupProperties = Readonly<{
    group: string | React.ReactNode;
    children: React.ReactNode;
    forceOpen?: boolean;
}>;

function DeviceGroup({ group, children, forceOpen }: DeviceGroupProperties) {
    const [isOpen, setIsOpen] = useState(forceOpen || false);

    useEffect(() => {
        setIsOpen(!!forceOpen);
    }, [forceOpen]);

    const toggleExpand = useCallback(() => {
        setIsOpen(previous => !previous);
    }, []);


    return (
        <div
            className={`${styles.accordionContainer} ${isOpen ? styles.selected : ''}`}
        >
            <Accordion
                title={group}
                isOpen={isOpen}
                toggleExpand={toggleExpand}
                body={children}
            />
        </div>
    );
}

export default memo(DeviceGroup);

