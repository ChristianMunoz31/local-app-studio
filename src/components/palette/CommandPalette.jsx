import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, CornerDownLeft } from 'lucide-react';
import { useCommandPalette } from '../../hooks/useCommandPalette';
import { buildNavCommands } from './commands';
import { openAssistant } from '../assistant/openAssistant';
import { fuzzyFilter } from '../../utils/fuzzy';

// Manages the visible + closing state machine for the palette animation.
// useReducer avoids direct setState calls in useEffect (lint rule: set-state-in-effect).
function animReducer(s, action) {
  if (action === 'OPEN') return { visible: true, closing: false };
  if (action === 'START_CLOSE') return { visible: true, closing: true };
  if (action === 'HIDE') return { visible: false, closing: false };
  return s;
}

// Mount controller: keeps only the open state, and remounts PaletteInner fresh
// on each open so transient state (query, selection, pending quick action) resets cleanly
// without reset-on-close effects. Closing state delays unmount by 220ms to let
// the fade-out animation finish before the DOM node is removed.
/**
 * Search and navigation. Conversation lives in the Assistant panel: the Ask item hands the query
 * to it (see openAssistant). `assistantAvailable` is false on pages with no Assistant (the launcher setting does not matter).
 * `initialOpen` mounts it already open (the lazy host passes the trigger that loaded it).
 * @param {{ assistantAvailable?: boolean, initialOpen?: boolean }} props
 */
export default function CommandPalette({ assistantAvailable = false, initialOpen = false }) {
  const { open, setOpen } = useCommandPalette(initialOpen);
  const [{ visible, closing }, dispatch] = useReducer(animReducer, { visible: false, closing: false });

  useEffect(() => {
    if (open) {
      dispatch('OPEN');
    } else if (visible) {
      dispatch('START_CLOSE');
      const t = setTimeout(() => dispatch('HIDE'), 220);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  return <PaletteInner onClose={() => setOpen(false)} closing={closing} assistantAvailable={assistantAvailable} />;
}

function PaletteInner({ onClose, closing, assistantAvailable }) {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [selectedRaw, setSelected] = useState(0);
    const inputRef = useRef(null);
  const listRef = useRef(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (idx) => `${baseId}-opt-${idx}`;

  // Focus the input on mount.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const askAssistant = useCallback(
    (q) => {
      onClose();
      openAssistant({ prompt: q });
    },
    [onClose],
  );

  // Assemble the ordered, selectable command list for the current query.
  const items = useMemo(() => {
    const q = query.trim();
    const list = [];
    const askItem = assistantAvailable
      ? {
          id: 'ask',
          label: q ? `Ask Assistant: “${q}”` : 'Open Assistant',
          icon: Sparkles,
          group: 'Assistant',
          onSelect: () => askAssistant(q),
        }
      : null;

    // With no query, Open Assistant leads. With a query it goes last so Enter picks the
    // best command or search match, not an accidental question.
    if (askItem && !q) list.push(askItem);

    const nav = buildNavCommands({ navigate }).map((c) => ({
      ...c,
      onSelect: () => {
        c.run();
        onClose();
      },
    }));
    list.push(...fuzzyFilter(q, nav, (i) => i.label));

    if (askItem && q) list.push(askItem);
    return list;
  }, [query, navigate, onClose, askAssistant, assistantAvailable]);

  // Clamp selection at render (no setState-in-effect) so the list staying in sync
  // with a changing result set is derived, not stored.
  const selected = items.length ? Math.min(selectedRaw, items.length - 1) : 0;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(Math.min(selected + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(Math.max(selected - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[selected]?.onSelect?.();
    }
  };

  // Scroll the selected row into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const placeholder = assistantAvailable
    ? 'Search commands or ask Assistant…'
    : 'Search commands…';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className={`glass-overlay absolute inset-0 ${closing ? 'animate-overlay-out' : 'animate-overlay-in'}`} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={`glass-strong relative w-full max-w-xl rounded-2xl overflow-hidden ${closing ? 'animate-overlay-out' : 'animate-overlay-in'}`}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-slate700/50">
          <Search size={16} className="text-slate-slate400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={items.length > 0 ? listId : undefined}
            aria-activedescendant={items.length > 0 ? optionId(selected) : undefined}
            aria-autocomplete="list"
            className="flex-1 min-w-0 bg-transparent text-sm text-slate-slate100 placeholder:text-slate-slate400"
          />
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {items.length > 0 ? `${items.length} result${items.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {/* Body */}
        <CommandResults
          items={items}
          selected={selected}
          setSelected={setSelected}
          listRef={listRef}
          listId={listId}
          optionId={optionId}
        />
      </div>
    </div>
  );
}

function CommandResults({ items, selected, setSelected, listRef, listId, optionId }) {
  if (items.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-slate-slate400">No matches. Try something else.</div>;
  }
  return (
    <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-2">
      {items.map((item, idx) => {
        const Icon = item.icon;
        const showGroup = idx === 0 || items[idx - 1].group !== item.group;
        return (
          <div key={item.id} role="presentation">
            {showGroup && (
              <div aria-hidden="true" className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-slate400">
                {item.group}
              </div>
            )}
            <div
              id={optionId(idx)}
              role="option"
              aria-selected={idx === selected}
              tabIndex={-1}
              data-idx={idx}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => item.onSelect?.()}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors cursor-pointer ${
                idx === selected ? 'bg-slate-slate700/60 text-slate-slate100' : 'text-slate-slate300 hover:bg-slate-slate700/40'
              }`}
            >
              {Icon && <Icon size={15} className="text-slate-slate400 shrink-0" aria-hidden="true" />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-xs text-slate-slate400 truncate max-w-[40%]">{item.hint}</span>}
              {idx === selected && <CornerDownLeft size={13} className="text-slate-slate400 shrink-0" aria-hidden="true" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
