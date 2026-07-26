import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UseDialogFocusOptions {
    isOpen: boolean;
    onClose: () => void;
    canClose?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    fallbackFocusRef?: RefObject<HTMLElement | null>;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
    return Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(element => (
        !element.matches(':disabled')
        && !element.closest('[hidden], [aria-hidden="true"]')
    ));
}

export function useDialogFocus<T extends HTMLElement>({
    isOpen,
    onClose,
    canClose = true,
    initialFocusRef,
    fallbackFocusRef,
}: UseDialogFocusOptions): RefObject<T | null> {
    const dialogRef = useRef<T>(null);
    const onCloseRef = useRef(onClose);
    const canCloseRef = useRef(canClose);

    useEffect(() => {
        onCloseRef.current = onClose;
        canCloseRef.current = canClose;
    }, [canClose, onClose]);

    useEffect(() => {
        if (!isOpen || !dialogRef.current) {
            return;
        }

        const dialog = dialogRef.current;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const initialFocus = initialFocusRef?.current
            ?? getFocusableElements(dialog)[0]
            ?? dialog;

        initialFocus.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (canCloseRef.current) {
                    event.preventDefault();
                    onCloseRef.current();
                }
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const focusableElements = getFocusableElements(dialog);
            if (focusableElements.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;

            if (event.shiftKey) {
                if (activeElement === firstElement || !dialog.contains(activeElement)) {
                    event.preventDefault();
                    lastElement.focus();
                }
                return;
            }

            if (activeElement === lastElement || !dialog.contains(activeElement)) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);

            const restoreTarget = previouslyFocused?.isConnected
                ? previouslyFocused
                : fallbackFocusRef?.current;

            if (restoreTarget?.isConnected) {
                restoreTarget.focus();
            }
        };
    }, [fallbackFocusRef, initialFocusRef, isOpen]);

    return dialogRef;
}
