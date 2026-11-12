// The settings of one part, in a popover under its toolbar (not a modal: the page stays visible and editable). Opened by the
// Settings tool, Enter on the part or a double click. It starts with its name ("Settings for Heading"), then, in this order: the
// table the part shows, what a Button does, the part's own words and choices (the List or Table first), and, last, its Width
// (WidthSettings.tsx), after the grid's Place parts freely switch and a placed part's Place section. A built-in part shows one control per setting in plain words. A feature shows the feature's own settings,
// "Update to latest" and "Turn into plain parts". Columns also offer "Add a column", Tabs "Add a tab" and a Column offers "Remove this column".
// One rule for a connection: picking the table of a part that has none connects it at once, the line says "Connected to Jobs." and the
// popover has no Apply (and no "Apply changes the page" sentence) in that state.
// In the menu bar a search box only has its hint text, and says what it searches. The focus starts in the first control after
// the table line; Escape closes it and the focus goes back to the Settings tool.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { COLUMN_COUNT } from '@/catalog/enums';
import { getPartDefinition } from '@/catalog/definitions';
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import FeatureValuesForm from '../components/FeatureValuesForm';
import { HINT_CLASS, POPOVER_CLASS } from '../components/ui';
import { dataBindOf } from '../lib/bindChoice';
import { followResult } from '../lib/followWords';
import { NEW_SOURCE_PREFIX, NOT_CONNECTED, connectLayer, connectedTableOf, offerFor } from '../lib/bindOnDrop';
import type { ConnectChoice, Source } from '../lib/bindOnDrop';
import { latestValues, withLists } from '../lib/featureFromSelection';
import { withOwnWords } from '../lib/featureWords';
import { plainMessage } from '../lib/issueWords';
import { layerIds } from '../lib/layout';
import { addColumn, addTab, configureLayer, findLayer, newFeatureLayer, removeLayer, replaceLayer, canSize } from '../lib/layoutTree';
import { buttonKindOf } from '../lib/actionKind';
import { isFreeGrid, placeOf } from '../lib/gridLayout';
import { FIELD_WORDS } from '../lib/fields';
import { COLUMNS_HINT, blockName, tableLabel } from './designLabels';
import ActionSettings from './ActionSettings';
import ConnectionBadge from './ConnectionBadge';
import { connectionOf } from './connections';
import type { ConnectionMode } from './connections';
import { useDesign } from './DesignContext';
import GridModeSettings from './GridModeSettings';
import PlaceSettings from './PlaceSettings';
import { offerWordsFor } from './offerWords';
import { partIndicator } from './indicator';
import { changeDraft, changedValues, editableSettings, fieldGaps, initialDraft, settingRows } from './settingsModel';
import type { SettingRow } from './settingsModel';
import WidthSettings from './WidthSettings';

const POPOVER = `${POPOVER_CLASS} pointer-events-auto absolute top-4 z-30 w-80 max-w-[85vw] space-y-3 p-4 text-left`;

/** The popover hangs from the right edge of its block; a block near the canvas's left edge (the menu start slot) anchors it left instead. */
const POPOVER_RIGHT = 'right-2';
const POPOVER_LEFT = 'left-2';
/** The 0.5rem the right-2 and left-2 classes keep from the block's edge, in px. */
const POPOVER_INSET = 8;

const MAX_PAGES = 8;

/** The line after a connection pick: "Connected to Jobs." */
const CONNECTED = (table: string): string => `Connected to ${table}.`;

/** "Add a column" on Columns, "Add a tab" on Tabs and "Remove this column" on a Column; nothing for any other part. */
function ColumnActions({ layer, onProblem, onClose }: { layer: LayoutLayer; onProblem(message: string): void; onClose(): void }) {
  const { root, ctx, apply, focusBlock, tell } = useDesign();
  if (layer.feature !== undefined) return null;
  if (layer.type === 'Tabs') {
    const count = Array.isArray(layer.children) ? layer.children.length : 0;
    const add = (): void => {
      const result = addTab(root, layer.id, ctx, layerIds(root));
      const message = apply(result);
      if (message !== null) return onProblem(message);
      if (result.ok) {
        tell(`Added Tab ${count + 1}.`, true);
        focusBlock(result.focusId);
      }
      onClose();
    };
    return (
      <div className="flex justify-end">
        <button type="button" className={btnSecondary} onClick={add}>
          Add a tab
        </button>
      </div>
    );
  }
  if (layer.type === 'Columns') {
    const count = Array.isArray(layer.children) ? layer.children.length : 0;
    const add = (): void => {
      const result = addColumn(root, layer.id, ctx, layerIds(root));
      const message = apply(result);
      if (message !== null) return onProblem(message);
      if (result.ok) {
        tell(`Added Column ${count + 1}.`, true);
        focusBlock(result.focusId);
      }
      onClose();
    };
    return (
      <div className="flex justify-end">
        <button type="button" className={btnSecondary} disabled={count >= COLUMN_COUNT.max} onClick={add}>
          Add a column
        </button>
      </div>
    );
  }
  if (layer.type !== 'Column') return null;
  const found = findLayer(root, layer.id);
  if (found === null || found.parent === null || found.parent.type !== 'Columns') return null;
  const count = Array.isArray(found.parent.children) ? found.parent.children.length : 0;
  const at = found.index + 1;
  const removeIt = (): void => {
    const result = removeLayer(root, layer.id);
    const message = apply(result);
    if (message !== null) return onProblem(message);
    tell(`Removed Column ${at}.`, true);
    if (result.ok) focusBlock(result.focusId);
    onClose();
  };
  return (
    <div className="flex justify-end">
      <button type="button" className={btnSecondary} disabled={count <= COLUMN_COUNT.min} onClick={removeIt}>
        Remove this column
      </button>
    </div>
  );
}

const MENU_SEARCH_LINE = 'Searches the first list on the page that is open. On a page with no list it is hidden.';

function BuiltInSettings({ layer, name, sized, onClose }: { layer: LayoutLayer; name: string; sized: boolean; onClose(): void }) {
  const uid = useId();
  const { root, spec, page, ctx, apply, focusBlock, tell, tree, askTable, builder } = useDesign();
  const slotWords = builder !== undefined;
  const menuSearch = tree === 'menu' && layer.type === 'SearchBox';
  const settings = useMemo(() => editableSettings(layer, ctx), [layer, ctx]);
  const [draft, setDraft] = useState(() => initialDraft(settings));
  const [problem, setProblem] = useState<string | null>(null);
  const rows = settingRows(settings, draft, spec, page, ctx, layer.type);
  const actions = <ColumnActions layer={layer} onProblem={setProblem} onClose={onClose} />;
  const problemNote =
    problem === null ? null : (
      <p role="alert" className={formErrorClass}>
        {problem}
      </p>
    );

  if (settings.length === 0) {
    return (
      <>
        {layer.type !== 'Tabs' && <p className="text-sm text-slate-slate300">{menuSearch ? MENU_SEARCH_LINE : sized ? 'No other settings.' : 'Nothing to set for this part.'}</p>}
        {actions}
        {problemNote}
        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  // The table or list the part is tied to. A part with none yet, or one pointed at "New list of ...", is built again on the choice.
  const def = getPartDefinition(layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  const dataTarget = bind === null ? null : `props.${bind.prop}`;
  const chosen = dataTarget === null ? '' : (draft[dataTarget] ?? '');
  const unconnected = tree === 'page' && connectionOf(layer, ctx, spec)?.state === 'not_connected';
  // The pick is the whole job of this popover while the part has no table: no Apply.
  const connecting = unconnected && bind !== null;
  // The List or Table comes first among the part's own settings.
  const ordered = [...rows.filter((r) => r.target === dataTarget), ...rows.filter((r) => r.target !== dataTarget)];

  // Field settings whose table has no field of the right kind: each offers Add a field.
  const gaps = tree === 'page' ? fieldGaps(settings, draft, ctx) : {};
  const current = dataTarget === null ? undefined : settings.find((s) => s.target === dataTarget)?.value;
  /** The List or Table picked in the box and not applied yet, or null when it is the part's own. */
  const pendingChoice = (): ConnectChoice | null => {
    if (bind === null || chosen === '' || chosen === NOT_CONNECTED || chosen === current) return null;
    if (chosen.startsWith(NEW_SOURCE_PREFIX)) return { newSourceOn: chosen.slice(NEW_SOURCE_PREFIX.length) };
    return bind.kind === 'source' ? { sourceId: chosen } : { table: chosen };
  };
  const newTable = (): void => {
    onClose();
    askTable({ kind: 'new_table', layerId: layer.id });
  };
  const addField = (target: string, table: string): void => {
    const choice = pendingChoice();
    onClose();
    askTable({ kind: 'add_field', layerId: layer.id, table, target, choice });
  };
  const emptyHint = (row: SettingRow): string => {
    if (row.setting.kind === 'field') return `Nothing to pick from yet. Press ${slotWords ? 'Add a field slot' : 'Add a field'}.`;
    if (row.setting.kind === 'table' || row.setting.kind === 'source') return `Nothing to pick from yet. Press ${slotWords ? 'Add a table slot' : 'New table'}.`;
    return 'Nothing to pick from yet.';
  };

  const connect = (value: string): void => {
    if (bind === null) return;
    if (value === NOT_CONNECTED) {
      setProblem('Pick a table first.');
      return;
    }
    const choice: ConnectChoice = value.startsWith(NEW_SOURCE_PREFIX) ? { newSourceOn: value.slice(NEW_SOURCE_PREFIX.length) } : bind.kind === 'source' ? { sourceId: value } : { table: value };
    const out = connectLayer(root, layer.id, choice, spec, page, layerIds(root));
    const message = apply(out.result, out.sources);
    if (message !== null) {
      setProblem(message);
      return;
    }
    // The table the part is on now: the new list's, else the list or table that was picked.
    const connectedLayer = out.result.ok ? (findLayer(out.result.root, layer.id)?.layer ?? layer) : layer;
    const picked = out.added !== null ? out.added.table : connectedTableOf(connectedLayer, out.sources);
    if (picked !== null) {
      const table = tableLabel(spec, picked);
      const lead = CONNECTED(table);
      if (out.added === null) tell(lead, true);
      else tell(out.added.mode === 'record' ? `${lead} This page now shows one ${table} record from its address.` : `${lead} Added a list of ${table} to this page.`, true);
    }
    focusBlock(layer.id);
    onClose();
  };

  const submit = (): void => {
    if (tree === 'page' && bind !== null && (unconnected || chosen.startsWith(NEW_SOURCE_PREFIX))) {
      connect(chosen);
      return;
    }
    const changed = changedValues(settings, draft);
    if (Object.keys(changed).length === 0) {
      onClose();
      return;
    }
    // Words the Studio wrote ("Add to Crews", "Crews by Status", "Sum of Amount") follow the new table, list or field; typed words stay.
    const message = apply(followResult(root, configureLayer(root, layer.id, changed, ctx, tree), layer.id, spec, page.sources));
    if (message !== null) {
      setProblem(message);
      return;
    }
    focusBlock(layer.id);
    onClose();
  };

  const control = (row: SettingRow, id: string): ReactNode => {
    const value = draft[row.target] ?? '';
    const set = (next: string): void => {
      setProblem(null);
      setDraft((prev) => changeDraft(settings, prev, row.target, next, ctx, spec));
      // A part that is not connected takes the table at once, like Width: one Undo step, no Apply.
      if (unconnected && bind !== null && row.target === dataTarget && next !== NOT_CONNECTED) connect(next);
    };
    if (row.setting.kind === 'pages' || row.setting.kind === 'columns') {
      const picked = value.split(',').filter((v) => v !== '');
      const options = row.choices ?? [];
      const limit = row.setting.kind === 'columns' ? (row.max ?? MAX_PAGES) : MAX_PAGES;
      return (
        <fieldset id={id} className="space-y-1">
          <legend className={labelClass}>{row.label}</legend>
          {row.setting.kind === 'columns' && <p className={HINT_CLASS}>{COLUMNS_HINT}</p>}
          {row.setting.kind === 'pages' && options.length === 0 && <p className={HINT_CLASS}>No pages to pick yet.</p>}
          {options.map((c) => {
            const on = picked.includes(c.value);
            return (
              <label key={c.value} className="flex items-center gap-2 text-sm text-slate-slate100">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && picked.length >= limit}
                  onChange={() => set(options.map((o) => o.value).filter((v) => (v === c.value ? !on : picked.includes(v))).join(','))}
                />
                {c.label}
              </label>
            );
          })}
        </fieldset>
      );
    }
    return (
      <>
        <label htmlFor={id} className={labelClass}>
          {row.label}
        </label>
        {row.setting.kind === 'number' ? (
          <input id={id} type="number" inputMode="numeric" className={inputClass} min={row.min} max={row.max} step={1} value={value} onChange={(e) => set(e.target.value)} />
        ) : row.choices !== null ? (
          <>
            <select id={id} className={inputClass} value={value} disabled={row.choices.length === 0} onChange={(e) => set(e.target.value)}>
              {!row.choices.some((c) => c.value === value) && <option value={value}>Pick one</option>}
              {row.choices.map((c) => (
                <option key={c.value} value={c.value} disabled={c.disabled === true}>
                  {c.label}
                </option>
              ))}
            </select>
            {row.choices.length === 0 && <p className={`mt-1 ${HINT_CLASS}`}>{emptyHint(row)}</p>}
          </>
        ) : row.multiline ? (
          <textarea id={id} className={inputClass} rows={3} maxLength={LIMITS.layerTextChars} value={value} onChange={(e) => set(e.target.value)} />
        ) : (
          <input id={id} className={inputClass} maxLength={LIMITS.layerTextChars} value={value} onChange={(e) => set(e.target.value)} />
        )}
      </>
    );
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {menuSearch && <p className="text-sm text-slate-slate300">{MENU_SEARCH_LINE}</p>}
      {ordered.map((row, i) =>
        row.hidden ? null : (
          <div key={row.target} data-setting-target={row.target}>
            {control(row, `${uid}-${i}`)}
            {tree === 'page' && bind !== null && row.target === dataTarget && (
              <div className="mt-1 flex justify-end">
                <button type="button" className={btnSecondary} aria-label={slotWords ? `Add a table slot for ${name}` : `Make a new table for ${name}`} onClick={newTable}>
                  {slotWords ? 'Add a table slot' : 'New table'}
                </button>
              </div>
            )}
            {Object.hasOwn(gaps, row.target) && (
              <div className="mt-1 flex justify-end">
                <button type="button" className={btnSecondary} onClick={() => addField(row.target, gaps[row.target].table)}>
                  {slotWords ? 'Add a field slot' : 'Add a field'}
                  <span className="sr-only">{`: a ${FIELD_WORDS[gaps[row.target].type]} field in ${tableLabel(spec, gaps[row.target].table)}`}</span>
                </button>
              </div>
            )}
          </div>
        ),
      )}
      {actions}
      {problemNote}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          {connecting ? 'Close' : 'Cancel'}
        </button>
        {!connecting && (
          <button type="submit" className={btnPrimary}>
            Apply
          </button>
        )}
      </div>
    </form>
  );
}

/** What the status line says after Update to latest. */
const UPDATED_LINE = (label: string): string => `Updated ${label} to the latest version.`;

function FeatureSettings({ layer, onClose }: { layer: LayoutLayer; onClose(): void }) {
  const { root, spec, page, ctx, library, apply, focusBlock, tell, builder } = useDesign();
  const marker = layer.feature;
  const def = marker === undefined ? undefined : library.get(marker.id);
  const [problems, setProblems] = useState<string[]>([]);
  /** The values of the newest version for this block: kept ones, new ones filled, and the builder's default words following the table. */
  const latest = useMemo((): { values: Record<string, string>; made: Source[] } | null => {
    if (def === undefined || marker === undefined) return null;
    const settled = latestValues(def, ctx, marker.params);
    return { values: withOwnWords(def, settled.values, settled.ctx, spec).values, made: settled.made };
  }, [def, marker, ctx, spec]);
  if (marker === undefined) return null;
  const outdated = def !== undefined && marker.version < def.version;

  /** Puts the feature back with these values (and the lists they need). Returns the problems, and clears the ones shown before. */
  const replaceWith = (values: Record<string, string>, made: Source[] = [], done?: string): string[] => {
    setProblems([]);
    if (def === undefined) return [];
    const taken = layerIds(root);
    for (const id of layerIds(layer)) taken.delete(id);
    const within = made.length === 0 ? ctx : withLists(ctx, made);
    const worded = withOwnWords(def, values, within, spec);
    const expanded = newFeatureLayer(worded.def, worded.values, within, library, taken, layer.id);
    if (!expanded.ok) return expanded.issues.map((i) => plainMessage(i.message));
    const message = apply(replaceLayer(root, layer.id, expanded.value), made.length === 0 ? undefined : [...page.sources, ...made]);
    if (message !== null) return [plainMessage(message)];
    focusBlock(layer.id);
    onClose();
    if (done !== undefined) tell(done, true);
    return [];
  };

  const updateToLatest = (): void => {
    if (latest !== null && def !== undefined) setProblems(replaceWith(latest.values, latest.made, UPDATED_LINE(def.label)));
  };

  const detach = (): void => {
    // The name goes with the feature; the width stays, because it belongs to the place.
    const plain: LayoutLayer = { id: layer.id, type: layer.type, ...(layer.sizing === undefined ? {} : { sizing: layer.sizing }), props: layer.props, children: layer.children };
    const message = apply(replaceLayer(root, layer.id, plain));
    if (message !== null) {
      setProblems([plainMessage(message)]);
      return;
    }
    focusBlock(layer.id);
    onClose();
  };

  return (
    <div className="space-y-3">
      {def === undefined ? (
        <p className="text-sm text-slate-slate300">This feature is not in your library. Its parts still work.</p>
      ) : (
        <>
          <p className="text-sm text-slate-slate300">{`Feature: ${def.label}`}</p>
          {outdated && <p className="text-xs text-accent-amber">A newer version is in your library.</p>}
          <FeatureValuesForm
            def={def}
            ctx={ctx}
            words={spec}
            initial={outdated ? (latest?.values ?? marker.params) : marker.params}
            submitLabel="Apply"
            cancelLabel="Cancel"
            onSubmit={(values, made) => replaceWith(values, made)}
            onCancel={onClose}
            slotWords={builder !== undefined}
          />
          <p className={HINT_CLASS}>Changing values replaces the parts inside this feature.</p>
        </>
      )}
      {problems.length > 0 && (
        <ul role="alert" className={`${formErrorClass} list-disc pl-4`}>
          {[...new Set(problems)].slice(0, 4).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {outdated && def !== undefined && (
          <button type="button" className={btnSecondary} onClick={updateToLatest}>
            Update to latest
          </button>
        )}
        <button type="button" className={btnSecondary} onClick={detach}>
          Turn into plain parts
        </button>
      </div>
      <p className={HINT_CLASS}>Keeps the parts here. Later changes to the feature no longer reach them.</p>
    </div>
  );
}

/** What a part does with its table, in one line under the pill. */
const MODE_LINE: Readonly<Record<ConnectionMode, string>> = {
  'shows records': 'It shows records.',
  'one record': 'It shows one record.',
  'adds records': 'It adds records.',
  'edits this record': 'It edits this record.',
};

export default function BlockSettings({ layer, onClose }: { layer: LayoutLayer; onClose(): void }) {
  const { root, spec, page, ctx, library, builder, settingsFocus, menuPosition, tree } = useDesign();
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [anchorLeft, setAnchorLeft] = useState(false);
  // Right-anchored, the popover would cross the canvas's left edge when the portal box's right edge minus the popover's width (and
  // its 8 px inset) is left of the canvas. The portal box (data-chrome) is placed after this mounts, so it is measured again when
  // the box moves; a box that is not placed yet (no width) decides nothing. The test does not depend on the current anchor.
  useLayoutEffect(() => {
    const popover = ref.current;
    const wrap = popover?.closest<HTMLElement>('[data-chrome]');
    const canvas = wrap?.parentElement;
    if (!popover || !wrap || !canvas) return;
    const decide = (sync: boolean): void => {
      const box = wrap.getBoundingClientRect();
      if (box.width === 0) return;
      const left = box.right - POPOVER_INSET - popover.getBoundingClientRect().width < canvas.getBoundingClientRect().left;
      // From the observer the update is flushed at once, so a popover on the wrong side is never painted for one frame.
      if (sync) flushSync(() => setAnchorLeft(left));
      else setAnchorLeft(left);
    };
    decide(false);
    if (typeof MutationObserver === 'undefined') return;
    const watch = new MutationObserver(() => decide(true));
    watch.observe(wrap, { attributes: true, attributeFilter: ['style'] });
    return () => watch.disconnect();
  }, []);
  // Read once, when the popover opens.
  const firstFocus = useRef(settingsFocus);
  const connection = layer.feature === undefined ? connectionOf(layer, ctx, spec) : null;
  const offer = connection?.state === 'not_connected' && tree === 'page' ? offerFor(layer, spec, page) : null;
  const inBuilder = builder !== undefined;
  const indicator = partIndicator(layer, ctx, spec, page, { library, builder: inBuilder });
  const found = findLayer(root, layer.id);
  const name = blockName(layer, layer.type === 'Column' ? (found?.parent ?? null) : null, menuPosition);
  const sized = canSize(root, layer.id);
  const gridMode = tree === 'page' && layer.type === 'Grid' && layer.feature === undefined && found !== null && !found.inBlock;
  const placed = tree === 'page' && found !== null && !found.inBlock && isFreeGrid(found.parent) && placeOf(root, layer.id) !== null;
  useEffect(() => {
    // "Connect" and a part that needs its table chosen send the focus to that control; otherwise the first one after the table line.
    const target = firstFocus.current;
    const wanted = target === null ? null : ref.current?.querySelector<HTMLElement>(`[data-setting-target="${target}"] select, [data-setting-target="${target}"] input`);
    (wanted ?? ref.current?.querySelector<HTMLElement>('input, select, textarea, button'))?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    // Keys from the confirm of GridModeSettings (a portal) reach this handler through React; the confirm handles its own Escape.
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <div ref={ref} role="dialog" aria-labelledby={headingId} className={`${POPOVER} ${anchorLeft ? POPOVER_LEFT : POPOVER_RIGHT}`} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
      <h3 id={headingId} className="text-sm font-semibold text-slate-slate100">{`Settings for ${name}`}</h3>
      {indicator !== null && (
        <div className="flex">
          <ConnectionBadge indicator={indicator} />
        </div>
      )}
      {connection?.state === 'connected' && <p className="text-sm text-slate-slate300">{MODE_LINE[connection.mode]}</p>}
      {connection?.state === 'not_connected' && <p className="text-sm text-slate-slate300">{offer === null ? 'Pick one below.' : offerWordsFor(offer, inBuilder)}</p>}
      {layer.feature === undefined && <ActionSettings layer={layer} />}
      {layer.feature !== undefined ? (
        <FeatureSettings layer={layer} onClose={onClose} />
      ) : (
        // Keyed by the action kind so the draft of the settings below starts again when "What it does" changes the button's settings.
        <BuiltInSettings key={buttonKindOf(layer) ?? 'plain'} layer={layer} name={name} sized={sized} onClose={onClose} />
      )}
      {gridMode && <GridModeSettings layer={layer} name={name} />}
      {placed && <PlaceSettings layer={layer} name={name} />}
      {sized && <WidthSettings layer={layer} name={name} />}
      {!(connection?.state === 'not_connected' && tree === 'page') && <p className={HINT_CLASS}>{inBuilder ? 'Apply changes the feature. Save feature keeps it.' : 'Apply changes the page. Save keeps it.'}</p>}
    </div>
  );
}
