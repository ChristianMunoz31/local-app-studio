import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, FocusEvent } from 'react';
import { Search } from 'lucide-react';
import { inputClass } from '../../../../../src/components/shared/formStyles.js';
import { useCatalogData, useIsLive, useRunAction } from '../../../../../src/catalog/context.tsx';
import type { GlobalSearchGroup } from '../../../../../src/catalog/context.tsx';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { ErrorLine } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface GlobalSearchProps extends EditorProps {
  placeholder?: string;
}

const DEBOUNCE_MS = 250;
const NO_MATCH = 'No records match.';
/** The server answers nothing for less (a shorter term would scan every table on each key), so nothing is sent. */
const MIN_CODE_POINTS = 3;
const TOO_SHORT = 'Type 3 or more letters to search.';

interface Outcome {
  /** The trimmed term this answer is for. */
  term: string;
  groups: GlobalSearchGroup[];
  error: string | null;
}

/** "40 results in 3 tables" (the sum of the group totals, not of the 5 rows each shows), the words the live region says when an answer arrives. */
function resultWords(groups: readonly GlobalSearchGroup[]): string {
  const rows = groups.reduce((sum, g) => sum + Math.max(g.total, g.rows.length), 0);
  if (groups.length === 0 || rows === 0) return NO_MATCH;
  return `${rows} ${rows === 1 ? 'result' : 'results'} in ${groups.length} ${groups.length === 1 ? 'table' : 'tables'}`;
}

/**
 * One box that searches every table with text and a record page (`GET /api/data/_search`). Live pages only: on the canvas and in
 * previews (no navigation, or a data source with no `search`) the box is disabled and asks for nothing. The server decides
 * which tables take part; a hit opens its record page through the same navigate action a row click uses.
 */
export function GlobalSearch({ placeholder = 'Search all records', ...rest }: GlobalSearchProps) {
  const { className, ...dom } = editorDomProps(rest);
  const uid = useId();
  const listId = `${uid}-list`;
  const live = useIsLive();
  const { dataSource } = useCatalogData();
  const run = useRunAction();
  const enabled = live && typeof dataSource?.search === 'function';
  const [term, setTerm] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  // The popup opens when an answer arrives only while the person is still in the box (focus may have left during the wait).
  const focused = useRef(false);
  const text = term.trim();
  const tooShort = text !== '' && [...text].length < MIN_CODE_POINTS;

  useEffect(() => {
    const ds = dataSource;
    if (!enabled || text === '' || tooShort || ds === undefined || ds.search === undefined) return undefined;
    const find = ds.search.bind(ds);
    let current = true;
    const timer = setTimeout(() => {
      find(text).then(
        (result) => {
          if (!current) return;
          setOutcome({ term: text, groups: Array.isArray(result?.groups) ? result.groups : [], error: null });
          setActive(-1);
          setOpen(focused.current);
        },
        (e: unknown) => {
          if (!current) return;
          setOutcome({ term: text, groups: [], error: errorText(e, ERROR_TEXT.loadRowsFailed) });
          setOpen(focused.current);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, dataSource, text, tooShort]);

  const answer = enabled && !tooShort && outcome !== null && outcome.term === text ? outcome : null;
  const groups = answer?.groups ?? [];
  const starts: number[] = [];
  const options: Array<{ group: GlobalSearchGroup; row: GlobalSearchGroup['rows'][number] }> = [];
  for (const group of groups) {
    starts.push(options.length);
    for (const row of group.rows) options.push({ group, row });
  }
  const expanded = open && options.length > 0;
  const optionId = (i: number): string => `${uid}-option-${i}`;
  const status = enabled && tooShort ? TOO_SHORT : answer === null || answer.error !== null ? '' : resultWords(groups);

  const close = (): void => {
    setOpen(false);
    setActive(-1);
  };

  const choose = (item: (typeof options)[number]): void => {
    const done = run({ action: 'navigate', pageId: item.group.pageId, withRecord: true }, { table: item.group.table, id: item.row.id });
    if (!done.ok) {
      setOpenFailure(done.message);
      return;
    }
    setOpenFailure(null);
    setTerm('');
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!enabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return;
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      if (!expanded) {
        setOpen(true);
        setActive(down ? 0 : options.length - 1);
        return;
      }
      setActive((i) => (down ? (i + 1) % options.length : i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0 && active < options.length) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    focused.current = false;
    close();
  };

  return (
    <div {...dom} onBlur={onBlur} className={cx('relative', className)}>
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-[1.1rem] -translate-y-1/2 text-slate-slate400" />
      <input
        type="text"
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder={placeholder}
        maxLength={200}
        disabled={!enabled}
        className={cx(inputClass, 'pl-9')}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setActive(-1);
          setOpenFailure(null);
          if (e.target.value.trim() === '') setOpen(false);
        }}
        onFocus={() => {
          focused.current = true;
          if (options.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={listId} role="listbox" aria-label="Search results" hidden={!expanded} className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md py-1 glass-flat">
        {groups.map((group, gi) => (
          <div key={group.table} role="group" aria-labelledby={`${uid}-group-${gi}`}>
            <div id={`${uid}-group-${gi}`} className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-slate400">
              {group.label}
              {group.total > group.rows.length && <span className="ml-2 font-normal normal-case">{`Showing ${group.rows.length} of ${group.total}`}</span>}
            </div>
            {group.rows.map((row, ri) => {
              const i = starts[gi] + ri;
              return (
                <div
                  key={row.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose({ group, row })}
                  className={cx('cursor-pointer truncate px-3 py-2 text-sm text-slate-slate100', i === active ? 'bg-slate-slate700/60' : 'hover:bg-slate-slate700/40')}
                >
                  {row.title === '' ? row.id : row.title}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {open && answer !== null && answer.error === null && options.length === 0 && (
        <p aria-hidden="true" className="absolute left-0 right-0 z-30 mt-1 rounded-md px-3 py-2 text-sm text-slate-slate400 glass-flat">
          {NO_MATCH}
        </p>
      )}
      {answer !== null && answer.error !== null && <ErrorLine message={answer.error} />}
      {openFailure !== null && <ErrorLine message={openFailure} />}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
