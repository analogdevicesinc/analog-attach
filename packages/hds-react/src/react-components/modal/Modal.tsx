/**
 *
 * Copyright (c) 2024 Analog Devices, Inc.
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
import {useRef, type ReactNode, useEffect} from 'react';

import styles from './modal.module.scss';
import VscodeButton from '../../react-wrappers/VscodeButton';
import VscodeIcon from '../../react-wrappers/VscodeIcon'

export type ModalProps = {
	readonly isOpen: boolean;
	readonly handleModalClose: () => void;
	readonly children: ReactNode;
	readonly footer?: ReactNode;
	readonly title?: string;
};

function Modal({
	isOpen,
	footer,
	title,
	handleModalClose,
	children
}: ModalProps) {
	const modalRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = modalRef.current;

		if (isOpen) {
			dialog?.showModal();
		} else {
			dialog?.close();
		}

		return () => {
			dialog?.close();
		};
	}, [isOpen]);

	return (
		<dialog
			ref={modalRef}
			className={styles.modal}
			onClick={e => {
				if (e.target === modalRef.current) {
					modalRef.current?.close();
					handleModalClose();
				}
			}}
			onKeyDown={e => {
				if (e.key === 'Escape') {
					modalRef.current?.close();
					handleModalClose();
				}
			}}
		>
			<div className={styles.innerModal} data-test='inner-modal'>
				<div className={styles.modalHeader}>
					{title && <div className={styles.modalTitle}>{title}</div>}
					<VscodeButton
						iconOnly
						variant="tertiary"
						icon="close"
						onClick={() => {
							modalRef.current?.close();
							handleModalClose();
						}}
					>
						<VscodeIcon name="close" />
					</VscodeButton>
				</div>
				<div className={styles.modalBody}>{children}</div>
				{footer && <div className={styles.modalFooter}>{footer}</div>}
			</div>
		</dialog>
	);
}

export default Modal;