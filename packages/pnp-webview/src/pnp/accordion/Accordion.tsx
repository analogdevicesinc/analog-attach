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
import React, { useEffect, useRef } from 'react';
import { VscodeIcon } from '../../../../hds-react/src/react-wrappers';
import styles from './Accordion.module.scss';

type AccordionProperties = Readonly<{
    title: React.ReactNode;
    body: React.ReactNode;
    isOpen: boolean;
    id?: string;
    highlight?: boolean;
    toggleExpand: (title: React.ReactNode) => void;
}>;

export default function Accordion({
    id,
    title,
    body,
    highlight,
    isOpen,
    toggleExpand
}: AccordionProperties) {
    const accordionReference = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => {
                if (!accordionReference.current) {return;}

                const parentContainer = accordionReference.current.parentElement;

                if (parentContainer) {
                    const parentContainerBottom =
                        parentContainer.getBoundingClientRect().bottom;

                    const accordionBottom =
                        accordionReference.current.getBoundingClientRect().bottom;

                    const offsetFromBottom = 50;

                    if (accordionBottom > parentContainerBottom) {
                        parentContainer.scrollBy({
                            top:
                                accordionBottom -
                                (parentContainerBottom - offsetFromBottom),
                            behavior: 'smooth'
                        });
                    }
                }
            }, 250);
        }
    }, [isOpen]);

    return (
        <div
            ref={accordionReference}
            className={`${styles.container} ${isOpen ? styles.hasBorder : ''}`}
            data-test={`accordion:${title}`}
        >
            <div
                tabIndex={0}
                className={`${styles.header} ${highlight ? styles.highlight : ''}`}
                onClick={() => {
                    toggleExpand(id ?? title);
                }}
            >
                <div
                    className={`${styles.chevron}${isOpen ? ` ${styles.iconOpen}` : ''}`}
                >
                    <VscodeIcon name="chevron-right" size={16} />
                </div>
                <div className={styles.titleContainer}>
                    <span className={styles.title}>{title}</span>
                </div>
            </div>
            {isOpen && <section className={styles.body}>{body}</section>}
        </div>
    );
}

