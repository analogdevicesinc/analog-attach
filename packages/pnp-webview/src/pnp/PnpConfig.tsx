import { Allotment } from "allotment";
import { NavigationBar, useVscodeStore } from "attach-ui-lib";
import { EventCommands } from "extension-protocol";
import { useEffect } from "react";
import { useDeviceInstanceStore } from "../store/useDeviceInstanceStore";
import styles from "./PnpConfig.module.scss";
import { ActiveSensorList } from "./active-sensor-list/ActiveSensorList";
import ConfigSidebar from "./config-sidebar/ConfigSidebar";
import PnpDeviceList from "./pnp-device-list/PnpDeviceList";

export default function PnpConfig() {
    const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
    const loadDeviceInstances = useDeviceInstanceStore((state) => state.loadDeviceInstances);
    const loadDeviceConfiguration = useDeviceInstanceStore((state) => state.loadDeviceConfiguration);
    const subscribe = useVscodeStore((state) => state.onMessage);

    useEffect(() => {
        const observeElement = (element: HTMLElement) => {
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const width = entry.contentRect.width;
                    if (width < 400) {
                        element.classList.add(styles.narrow);
                    } else {
                        element.classList.remove(styles.narrow);
                    }
                }
            });

            resizeObserver.observe(element);
            return () => resizeObserver.disconnect();
        };

        const observers: Array<() => void> = [];

        // Use a small timeout to ensure DOM is ready, especially for Allotment.Pane
        const timeoutId = setTimeout(() => {
            // Find all elements with mainContentArea class
            const mainContentAreas = document.querySelectorAll<HTMLElement>(`.${styles.mainContentArea}`);
            for (const element of mainContentAreas) {
                const cleanup = observeElement(element);
                observers.push(cleanup);
            }
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            for (const cleanup of observers) {cleanup();}
        };
    }, [EditableDeviceInstance]);

    // Re-sync after backend notifies about file reload
    useEffect(() => {
        const handler = async () => {
            // Clear the editable device instance before reloading since UUIDs change on external file changes
            useDeviceInstanceStore.getState().setEditableDeviceInstance(undefined);
            await loadDeviceInstances();
        };

        const unsubscribe = subscribe((event: MessageEvent) => {
            const data = event.data;
            // Accept spec-compliant notifications (command) and legacy bare type messages
            if (data?.command === EventCommands.fileChanged) {
                void handler();
            }
        });

        return () => unsubscribe();
    }, [loadDeviceInstances, loadDeviceConfiguration, subscribe]);

    return (
        <div className={styles.layout}>
            <NavigationBar title="Analog Attach - Plug and Play" />
            <div className={styles.canvas}>
                <Allotment className={styles.outerAllotment}>
                    <Allotment.Pane preferredSize={262} minSize={180} maxSize={400}>
                        <div className={styles.taskSidebar}>
                            <PnpDeviceList />
                        </div>
                    </Allotment.Pane>
                    <Allotment.Pane>
                        {EditableDeviceInstance === undefined ? (
                            <div className={styles.mainContentArea}>
                                <ActiveSensorList />
                            </div>
                        ) : (
                            <Allotment className={styles.allotmentContainer}>
                                <Allotment.Pane className={styles.mainContentArea}>
                                    <ActiveSensorList />
                                </Allotment.Pane>
                                <Allotment.Pane preferredSize={262} minSize={262}>
                                    <div className={styles.scrollableContainer}>
                                        <ConfigSidebar />
                                    </div>
                                </Allotment.Pane>
                            </Allotment>
                        )}
                    </Allotment.Pane>
                </Allotment>
            </div>
        </div>
    );
}
