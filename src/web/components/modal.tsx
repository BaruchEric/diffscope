// src/web/components/modal.tsx
// Shared modal primitive for the settings modal, command palette, and
// shortcuts help overlay. Owns the backdrop, focus trap, backdrop-click-to-
// close, and a11y wiring so those three overlays don't each reinvent them.
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name announced to screen readers. */
  ariaLabel: string;
  /** Extra classes applied to the inner card (width, padding, etc). */
  cardClassName?: string;
  /** Optional id for aria-labelledby instead of aria-label. */
  labelledBy?: string;
  children: ReactNode;
}

// Elements inside the modal that Tab should cycle through.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal shell. Renders nothing when `!open`. When open:
 * - Backdrop click → onClose
 * - Escape is handled centrally by `shortcuts.tsx` (priority chain), NOT here,
 *   so the priority chain is preserved across all overlays.
 * - First focusable element is focused on open; focus is trapped within the
 *   card while the modal is open; prior focus is restored on close.
 */
export function Modal({
  open,
  onClose,
  ariaLabel,
  labelledBy,
  cardClassName,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement;
    // Focus the first focusable descendant — falls back to the card itself
    // so the user can still Tab into contents.
    const card = cardRef.current;
    if (card) {
      const first = card.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? card).focus();
    }
    return () => {
      const prev = prevFocusRef.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [open]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className={cardClassName}
      >
        {children}
      </div>
    </div>
  );
}
