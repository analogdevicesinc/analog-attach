import { Tooltip, VscodeIcon } from "hds-react";
import GhostButton from "../GhostButton/GhostButton";
import styles from "./NavigationBar.module.scss";

interface NavigationBarProps {
    title?: string;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
    canNavigateBack?: boolean;
    canNavigateForward?: boolean;
}

export default function NavigationBar({
    title,
    onNavigateBack,
    onNavigateForward,
    canNavigateBack,
    canNavigateForward,
}: NavigationBarProps) {
    return (
        <div className={styles.navigationBar}>
            <div className={styles.navigationBarControls}>
                {onNavigateBack && (
                    <Tooltip label="Go Back" position="bottom" align="start">
                        <GhostButton
                            icon="arrow-left"
                            onClick={onNavigateBack}
                            disabled={!canNavigateBack}
                        />
                    </Tooltip>
                )}
                {onNavigateForward && (
                    <Tooltip label="Go Forward" position="bottom" align="start">
                        <GhostButton
                            icon="arrow-right"
                            onClick={onNavigateForward}
                            disabled={!canNavigateForward}
                        />
                    </Tooltip>
                )}
            </div>
            <div className={styles.navigationBarSignPostingGroup}>
                <span className={styles.navigationBarTitle}>{title || "Analog Attach"}</span>
            </div>
            <div className={styles.navigationBarCommunity}>
                <VscodeIcon name="question"/>
            </div>
        </div>
    );
}
