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

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.scss';
import classNames from 'classnames';

export interface TooltipProps {
  /** The text to display in the tooltip */
  label?: string;
  /** Position of the tooltip relative to the trigger element */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Horizontal alignment for top/bottom positions, or vertical alignment for left/right */
  align?: 'center' | 'start' | 'end';
  /** Delay in milliseconds before showing the tooltip */
  showDelay?: number;
  /** Delay in milliseconds before hiding the tooltip */
  hideDelay?: number;
  /** Disable the tooltip */
  disabled?: boolean;
  /** Keep the tooltip always visible (overrides hover/focus behavior) */
  active?: boolean;
  /** Children that trigger the tooltip */
  children: ReactNode;
  /** Custom content to display in the tooltip. Takes precedence over the label property */
  tooltip?: ReactNode;
  /** CSS class name for styling */
  className?: string;
}

export function Tooltip({
  label = '',
  position = 'top',
  align = 'center',
  showDelay = 500,
  hideDelay = 0,
  disabled = false,
  active = false,
  children,
  tooltip,
  className,
}: TooltipProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const showTimeoutRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Create portal container
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Create portal container on mount to allow clean transitions
    const container = document.createElement('div');
    container.id = 'tooltip-portal';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '10000';
    document.body.appendChild(container);
    setPortalContainer(container);

    // Cleanup on unmount
    return () => {
      document.body.removeChild(container);
    };
  }, []);

  // Check if there's tooltip content (matches VscodeTooltip logic)
  const hasTooltipContent = useCallback(() => {
    return (tooltip !== undefined && tooltip !== null) || label.trim() !== '';
  }, [tooltip, label]);

  const clearTimeouts = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return { x: 0, y: 0 };

    const triggerRect = triggerRef.current.getBoundingClientRect();
    let x = 0;
    let y = 0;

    // Helper to compute the horizontal x based on align for top/bottom positions
    const alignedX = () => {
      switch (align) {
        case 'start':
          return triggerRect.left;
        case 'end':
          return triggerRect.right;
        default: // center
          return triggerRect.left + triggerRect.width / 2;
      }
    };

    // Helper to compute the vertical y based on align for left/right positions
    const alignedY = () => {
      switch (align) {
        case 'start':
          return triggerRect.top;
        case 'end':
          return triggerRect.bottom;
        default: // center
          return triggerRect.top + triggerRect.height / 2;
      }
    };

    switch (position) {
      case 'top':
        x = alignedX();
        y = triggerRect.top - 8;
        break;
      case 'bottom':
        x = alignedX();
        y = triggerRect.bottom + 8;
        break;
      case 'left':
        x = triggerRect.left - 8;
        y = alignedY();
        break;
      case 'right':
        x = triggerRect.right + 8;
        y = alignedY();
        break;
    }

    return { x, y };
  }, [position, align]);

  // Handle active prop changes
  useEffect(() => {
    if (active && !disabled && hasTooltipContent()) {
      const pos = calculatePosition();
      setTooltipPosition(pos);
      setIsVisible(true);
    } else if (!active) {
      setIsVisible(false);
    }
  }, [active, disabled, hasTooltipContent, calculatePosition]);

  const showTooltip = useCallback(() => {
    if (disabled || !hasTooltipContent()) {
      return;
    }

    // If active, tooltip is always visible, no need for delays
    if (active) {
      const pos = calculatePosition();
      setTooltipPosition(pos);
      setIsVisible(true);
      return;
    }

    clearTimeouts();
    showTimeoutRef.current = window.setTimeout(() => {
      const pos = calculatePosition();
      setTooltipPosition(pos);
      setIsVisible(true);
    }, showDelay);
  }, [disabled, hasTooltipContent, active, showDelay, calculatePosition, clearTimeouts]);

  const hideTooltip = useCallback(() => {
    // If active, don't hide the tooltip
    if (active) {
      return;
    }

    clearTimeouts();
    if (hideDelay > 0) {
      hideTimeoutRef.current = window.setTimeout(() => {
        setIsVisible(false);
      }, hideDelay);
    } else {
      setIsVisible(false);
    }
  }, [active, hideDelay, clearTimeouts]);

  const handleMouseEnter = useCallback(() => {
    showTooltip();
  }, [showTooltip]);

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  const handleFocus = useCallback(() => {
    showTooltip();
  }, [showTooltip]);

  const handleBlur = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearTimeouts();
    };
  }, [clearTimeouts]);

  const alignClass = align === 'start' ? styles.alignStart : align === 'end' ? styles.alignEnd : '';

  const tooltipClasses = [
    styles.tooltip,
    styles[position],
    alignClass,
    isVisible ? styles.visible : '',
    active ? styles.active : '',
  ].filter(Boolean).join(' ');



  // Determine tooltip content (tooltip prop takes precedence over label)
  const content = tooltip || label;
  const hasContent = hasTooltipContent();

  const tooltipElement = hasContent && !disabled && portalContainer && (
    <div
      style={{
        position: 'fixed',
        left: tooltipPosition.x,
        top: tooltipPosition.y,
        pointerEvents: 'none',
      }}
      className={className}
    >
      <div
        className={tooltipClasses}
        role="tooltip"
        aria-hidden={isVisible ? 'false' : 'true'}
      >
        {content}
      </div>
    </div>
  );

  // Always wrap children in a div for consistent behavior
  const wrappedChildren = (
    <div
      ref={triggerRef}
      className={classNames(styles.wrapper, className ?? '')}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
    </div>
  );

  return (
    <>
      {wrappedChildren}
      {tooltipElement && createPortal(tooltipElement, portalContainer)}
    </>
  );
}