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
import { memo, useMemo, useState } from 'react';
import DeviceGroup from '../device-group/DeviceGroup';
import DeviceItem from '../device-item/DeviceItem';
import type { DeviceGroupData } from '../../store';
import styles from './PnpNagivation.module.scss';
import { VscodeIcon, VscodeScrollable, VscodeTextfield } from 'hds-react';
import { containsSearch, SearchResult } from './helpers';
import { CatalogDevice } from 'extension-protocol';

type PnpNavigationProperties = Readonly<{
    deviceGroups: DeviceGroupData[];
    onConnectNode: (node: string) => void;
}>;

type DeviceWithSearchResult = CatalogDevice & { searchResult?: SearchResult };

function PnpNavigation({ deviceGroups, onConnectNode }: PnpNavigationProperties) {
    const [searchValue, setSearchValue] = useState('');

    const filteredDeviceGroups = useMemo(() => {
        if (!searchValue) {
            return deviceGroups;
        }

        const result: (DeviceGroupData & { searchResult?: SearchResult })[] = [];
        for (const group of deviceGroups) {
            const groupNameSearchResult = group.group ? containsSearch(group.group, searchValue) : { match: false, ranges: [] };

            // search inside matched group names
            if (groupNameSearchResult.match) {
                const devicesWithPossibleMatch = group.devices.map(device => ({
                    ...device,
                    searchResult: containsSearch(device.name, searchValue),
                }));
                const matchedDevices = devicesWithPossibleMatch.filter(device => device.searchResult?.match);
                const nonMatchedDevices = devicesWithPossibleMatch.filter(device => !device.searchResult?.match);
                const prioritizedDevices = [...matchedDevices, ...nonMatchedDevices];
                result.push({ ...group, devices: prioritizedDevices, searchResult: groupNameSearchResult });
                continue;
            }

            // search devices when group name does not match
            const matchedDevices: DeviceWithSearchResult[] = [];
            for (const device of group.devices) {
                const searchResult = containsSearch(device.name, searchValue);
                if (searchResult.match) {
                    matchedDevices.push({ ...device, searchResult });
                }
            }

            if (matchedDevices.length > 0) {
                result.push({ ...group, devices: matchedDevices });
            }
        }

        return result;
    }, [searchValue, deviceGroups]);

    if (deviceGroups.length === 0) {
        console.warn('PnpNavigation: No device groups to render');
        return <div>No device groups</div>;
    }

    const handleConnectNode = (deviceId: string) => {
        onConnectNode(deviceId);
    };

    const handleSearch = (event: any) => {
        setSearchValue(event.currentTarget.value);
    };

    const highlightMatches = (name: string, searchResult: SearchResult | undefined) => {
        if (!searchResult || !searchResult.match) {
            return name;
        }
        const { ranges } = searchResult;
        const parts = [];
        let lastIndex = 0;
        for (const [start, end] of ranges) {
            if (start > lastIndex) {
                parts.push(name.slice(lastIndex, start));
            }
            parts.push(<mark className={styles.highlight} key={start}>{name.slice(start, end)}</mark>);
            lastIndex = end;
        }
        if (lastIndex < name.length) {
            parts.push(name.slice(Math.max(0, lastIndex)));
        }
        return parts;
    };

    return (
        <div className={styles.deviceListContainer}>
            <div className={styles.searchContainer}>
                <VscodeTextfield placeholder="Search" onInput={handleSearch} style={{width: "100%"}}>
                    <VscodeIcon
                        slot="content-before"
                        name="search"
                        title="search"
                    ></VscodeIcon>
                </VscodeTextfield>
            </div>
            <VscodeScrollable className={styles.deviceListContent}>
                <div className={styles.deviceListContentInner}>
                    {filteredDeviceGroups.length === 0 && searchValue ? (
                        <div className={styles.noMatches}>
                            <VscodeIcon name="info" size={16} title='Info' className={styles.infoIcon} />
                            No Matches
                        </div>
                    ) : (
                        filteredDeviceGroups.map((groupData, index) => {
                            if (groupData.group) {
                                return (
                                    <div key={`group-${groupData.group}`}>
                                        <DeviceGroup
                                            group={highlightMatches(groupData.group, (groupData as any).searchResult)}
                                            forceOpen={!!searchValue}
                                        >
                                            <div>
                                                {(groupData.devices as DeviceWithSearchResult[]).map(device => (
                                                    <DeviceItem
                                                        key={`device-${device.name}`}
                                                        name={highlightMatches(device.name, device.searchResult)}
                                                        originalName={device.name}
                                                        onConnectNode={() => handleConnectNode(device.deviceId)}
                                                        hasParent
                                                    />
                                                ))}
                                            </div>
                                        </DeviceGroup>
                                    </div>
                                );
                            }

                            return (
                                <div key={`ungrouped-${index}`}>
                                    {(groupData.devices as DeviceWithSearchResult[]).map(device => (
                                        <DeviceItem
                                            key={`device-${device.name}`}
                                            name={highlightMatches(device.name, device.searchResult)}
                                            originalName={device.name}
                                            onConnectNode={() => handleConnectNode(device.deviceId)}
                                        />
                                    ))}
                                </div>
                            );
                        })
                    )}
                </div>
            </VscodeScrollable>
        </div>
    );
}

export default memo(PnpNavigation);
