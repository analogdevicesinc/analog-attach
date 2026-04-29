/**
 * Shared types for Zustand stores
 */

import type { CatalogDevice } from 'extension-protocol';

export type DeviceGroupData = {
    group: string | undefined;
    devices: CatalogDevice[];
};

