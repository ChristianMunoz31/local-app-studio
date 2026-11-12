// The keyboard shortcuts of Studio: rendered by the Help sheet and copied into docs/USER_GUIDE.md.
export interface Shortcut {
  where: string;
  keys: string;
  does: string;
}

export const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { where: 'Everywhere in Studio', keys: '?', does: 'Opens this help' },
  { where: 'Everywhere in Studio', keys: 'Escape', does: 'Closes a dialog or a menu' },
  { where: 'Apps', keys: 'Ctrl+Enter in the box', does: 'Makes the app from your words' },
  { where: 'Design and Data', keys: 'Ctrl+S', does: 'Saves your changes' },
  { where: 'Design and Data', keys: 'Ctrl+Z', does: 'Undoes the last change' },
  { where: 'Design and Data', keys: 'Ctrl+Y or Ctrl+Shift+Z', does: 'Redoes it' },
  { where: 'Design', keys: '/', does: 'Goes to the search box of the shelf' },
  { where: 'Design', keys: 'Enter on a part, or double click it', does: 'Opens its settings' },
  { where: 'Design', keys: 'Delete on a part', does: 'Removes it (Undo brings it back)' },
  { where: 'Design', keys: 'Alt+Arrow up or Alt+Arrow down on a part that is not placed freely', does: 'Moves it up or down' },
  { where: 'Design', keys: 'Alt+Arrow keys on a part placed freely on a grid', does: 'Moves it one cell' },
  { where: 'Design', keys: 'Alt+Shift+Arrow keys on a part placed freely on a grid', does: 'Makes it one cell wider, narrower, taller or shorter' },
  { where: 'Design', keys: 'Arrow keys on the width or height handle of a part placed freely', does: 'Changes its width or height by one cell' },
  { where: 'Design', keys: 'Home or End on the width or height handle of a part placed freely', does: 'Makes it as small as it can be, or as large as the free room allows' },
  { where: 'Design', keys: 'Enter or Space on the drag handle', does: 'Opens Move to... and lists the places' },
  { where: 'Design', keys: 'Arrow left or Arrow right on the handle between two parts', does: 'Gives one of them more room' },
  { where: 'Design', keys: 'Arrow left or Arrow right on Features or Look', does: 'Switches the shelf tab' },
  { where: 'Design', keys: 'Escape', does: 'Clears the selection, or cancels Add here or Beside' },
  { where: 'Features', keys: '/', does: 'Goes to the search box' },
  { where: 'Features', keys: 'Escape in the search box', does: 'Clears the search' },
];

/** The table split by area, in order of first appearance. */
export function shortcutAreas(): Array<{ where: string; rows: Shortcut[] }> {
  const areas: Array<{ where: string; rows: Shortcut[] }> = [];
  for (const row of SHORTCUTS) {
    const area = areas.find((a) => a.where === row.where);
    if (area) area.rows.push(row);
    else areas.push({ where: row.where, rows: [row] });
  }
  return areas;
}
