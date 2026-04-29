import React, { useState, useRef, useEffect, ReactNode, ReactElement } from 'react';
import styles from './Popup.module.scss';
import { isReactElement } from '../utilities';

interface PopupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  isOpen?: boolean;
  onClose?: () => void;
}

export function Popup({ children, isOpen: controlledIsOpen, onClose, ...props }: PopupProps) {
  const [isInternalOpen, setInternalOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : isInternalOpen;

  let triggerSlot: ReactElement | null = null;
  const contentSlot: ReactNode[] = [];

  React.Children.forEach(children, child => {
    if (isReactElement(child)) {
        const slot = (child.props as { slot?: string }).slot;
        if (slot === 'trigger') {
            triggerSlot = child as ReactElement;
        } else {
            contentSlot.push(child);
        }
    }
  });

  const handleTriggerClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (controlledIsOpen === undefined) {
      setInternalOpen(prev => !prev);
    }

    if (triggerSlot) {
        const originalOnClick = (triggerSlot.props as { onClick?: (event: React.MouseEvent) => void }).onClick;
        if (typeof originalOnClick === 'function') {
          originalOnClick(event);
        }
    }
  };

  const closePopup = () => {
    if (controlledIsOpen === undefined) {
      setInternalOpen(false);
    }
    if (onClose) {
      onClose();
    }
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
      closePopup();
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      if (isOpen) {
        if (!dialog.open) {
          dialog.show();
        }
      } else {
        if (dialog.open) {
          dialog.close();
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const triggerWithClickHandler = triggerSlot ? React.cloneElement(triggerSlot, {
    onClick: handleTriggerClick,
    'aria-haspopup': 'dialog',
    'aria-expanded': isOpen,
    'aria-controls': 'popup-dialog'
  }) : null;

  return (
    <div ref={containerRef} {...props} className={`${styles.popupContainer} ${props.className || ''}`}>
      {triggerWithClickHandler}
      <dialog
        id="popup-dialog"
        ref={dialogRef}
        className={styles.popupContent}
        onClose={closePopup}
        role="dialog"
      >
        {contentSlot}
      </dialog>
    </div>
  );
}


