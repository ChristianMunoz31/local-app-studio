// Where each kind of Local App Studio data lives. Display-only; keep in sync with the
// server routes and useSyncedSetting consumers when a module changes storage.

export const STORAGE_KINDS = ['database', 'synced', 'device', 'external'];

export const STORAGE_MAP = Object.freeze([
  {
    id: 'assistant',
    label: 'Assistant',
    kind: 'database',
    group: 'database',
    detail: 'Assistant chats',
  },
  { id: 'settings', label: 'Settings', kind: 'synced', group: 'database', detail: 'Theme, background and assistant options' },
  {
    id: 'updates',
    label: 'Update checks',
    kind: 'external',
    group: 'external',
    detail: 'The latest version number, fetched only if you turn on update checks',
  },
].map((entry) => Object.freeze(entry)));

export const STORAGE_GROUPS = Object.freeze(
  [
    { id: 'database', title: 'On this computer', description: "Saved in Local App Studio's data file on this computer" },
    { id: 'device', title: 'This browser only', description: 'Kept only in this browser' },
    { id: 'external', title: 'Live from other services', description: 'Fetched from the internet only if you turn it on' },
  ].map((group) => Object.freeze(group)),
);

/**
 * Pure: STORAGE_GROUPS in display order, each with its entries sorted by label.
 * Throws on an entry whose group is not in STORAGE_GROUPS so a new entry can never
 * silently vanish from the UI.
 */
export function groupStorageMap(entries = STORAGE_MAP) {
  const known = new Set(STORAGE_GROUPS.map((g) => g.id));
  const unknown = entries.find((entry) => !known.has(entry.group));
  if (unknown) throw new Error(`Unknown storage group "${unknown.group}" on entry "${unknown.id}"`);
  return STORAGE_GROUPS.map((group) => ({
    ...group,
    items: entries.filter((entry) => entry.group === group.id).sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/**
 * Pure: the "where is this stored" label and tone for one STORAGE_MAP entry.
 */
export function describeLocation(entry) {
  if (entry.kind === 'database' || entry.kind === 'synced') return { text: 'On this computer', tone: 'muted' };
  if (entry.kind === 'device') return { text: 'This browser only', tone: 'muted' };
  return { text: 'Online, if turned on', tone: 'muted' };
}
