import { VscodeIcon } from 'hds-react';
import styles from './ExpandButtons.module.scss';
import classNames from 'classnames';
import { useDeviceInstanceStore } from '@/store';

function handleKeyDown(event: React.KeyboardEvent, handler: () => void) {
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		handler();
	}
}

export function ExpandButtons() {
	const expandAllDevices = useDeviceInstanceStore((state) => state.expandAllDevices);

	const handleExpand = () => {
		expandAllDevices(true);
	};

	const handleCollapse = () => {
		expandAllDevices(false);
	};

	return (
		<div className={styles.container}>
			<div
				className={classNames(styles.button)}
				tabIndex={0}
				onClick={handleExpand}
				onKeyDown={(event) => handleKeyDown(event, handleExpand)}
				role="button"
				aria-label="Expand all devices"
			>
				<VscodeIcon name="hds-expand" />
			</div>
			<div
				className={styles.button}
				tabIndex={0}
				onClick={handleCollapse}
				onKeyDown={(event) => handleKeyDown(event, handleCollapse)}
				role="button"
				aria-label="Collapse all devices"
			>
				<VscodeIcon name="hds-collapse" />
			</div>
		</div>
	);
}