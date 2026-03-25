import { useDeviceInstanceStore } from "@/store";
import styles from "./ConfigSidebar.module.scss";
import ConfigHeader from "./config-header/ConfigHeader";
import DetailsSection from "./details-section/DetailsSection";
import BaseSensorConfig from "./sensor-config/base-config/BaseSensorConfig";
import ChannelCreateForm from "./channel-create/ChannelCreateForm";
import ChannelDetailsSection from "./channel-details/ChannelDetailsSection";

export default function ConfigSidebar() {
    const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
    const isCreatingChannel = useDeviceInstanceStore((state) => state.isCreatingChannel);
    const editingChannelName = useDeviceInstanceStore((state) => state.editingChannelName);

    // Determine render mode
    if (isCreatingChannel) {
        // Channel creation mode: Show header + creation form
        return (
            <div className={styles.configContent}>
                <ConfigHeader />
                <ChannelCreateForm />
            </div>
        );
    } else if (editingChannelName && EditableDeviceInstance) {
        // Channel edit mode: Show header + channel details + config
        return (
            <div className={styles.configContent}>
                <ConfigHeader />
                <ChannelDetailsSection />
                <BaseSensorConfig />
            </div>
        );
    } else if (EditableDeviceInstance) {
        // Device edit mode: Show header + device details + config (existing behavior)
        return (
            <div className={styles.configContent}>
                <ConfigHeader />
                <DetailsSection />
                <BaseSensorConfig />
            </div>
        );
    }

    // No configuration active
    return undefined;
}