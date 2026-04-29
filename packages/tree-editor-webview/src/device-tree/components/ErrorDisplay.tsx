import { VscodeIcon, VscodeLabel } from "hds-react";
import styles from './ErrorDisplay.module.scss';

export default function ErrorDisplay({ message }: { message: string }) {
    return (
        <div className={styles.errorDisplay}>
            <VscodeIcon name="error" className={styles.errorIcon} />
            <VscodeLabel>{message}</VscodeLabel>
        </div>
    );
}
