// Menu button (WAI-ARIA menu button pattern): the kit has no menu primitive and the vendored Radix one pulls editor libs.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Ellipsis } from 'lucide-react';
import { IconButton } from '@/components/shared/ItemActions.jsx';

export interface ActionMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect(trigger: HTMLButtonElement): void;
}

interface ActionMenuProps {
  /** Accessible name of the trigger. */
  label: string;
  menuLabel: string;
  items: ReadonlyArray<ActionMenuItem>;
}

const ITEM_CLASS =
  'block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-slate700/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';

export default function ActionMenu({ label, menuLabel, items }: ActionMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [focusAt, setFocusAt] = useState<'first' | 'last'>('first');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusAt === 'first' ? 0 : items.length - 1]?.focus();
  }, [open, focusAt, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openAt = (where: 'first' | 'last'): void => {
    setFocusAt(where);
    setOpen(true);
  };
  const closeToTrigger = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    const move = (to: number): void => {
      e.preventDefault();
      itemRefs.current[to]?.focus();
    };
    if (e.key === 'ArrowDown') move(index >= last ? 0 : index + 1);
    else if (e.key === 'ArrowUp') move(index <= 0 ? last : index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(last);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
    } else if (e.key === 'Tab') setOpen(false);
  };

  const choose = (item: ActionMenuItem): void => {
    if (item.disabled) return;
    const trigger = triggerRef.current;
    closeToTrigger();
    if (trigger) item.onSelect(trigger);
  };

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        ref={triggerRef}
        label={label}
        icon={Ellipsis}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openAt('first'))}
        onKeyDown={onTriggerKeyDown}
      />
      {open && (
        <ul id={menuId} role="menu" aria-label={menuLabel} onKeyDown={onMenuKeyDown} className="glass absolute right-0 top-9 z-10 min-w-40 rounded-md p-1">
          {items.map((item, i) => (
            <li key={item.id} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled ? 'true' : undefined}
                className={`${ITEM_CLASS} ${item.danger ? 'text-accent-red' : 'text-slate-slate100'} ${item.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => choose(item)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
