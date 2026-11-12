// The words of the status line after Undo and Redo, shared by the Data and Design steps so both say it the same way (DESIGN-phase14.md P-23).
// "Undid: removed the field Amount." (the label, first letter lower case) and "Redid: Removed the field Amount." (the label as it is).
// Pure. A label is the history entry's own words ("Removed the field Amount."); a closing full stop is dropped before the one this adds.
const bare = (label: string): string => label.trim().replace(/\.+$/, '');

/** "Undid: <label with a lower case first letter>." */
export function undidNotice(label: string): string {
  const text = bare(label);
  return `Undid: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

/** "Redid: <label>." */
export function redidNotice(label: string): string {
  return `Redid: ${bare(label)}.`;
}

/** The label a history entry gets for a change: its notice without the full stop ("Removed the field Amount"), else its own label. */
export function entryLabel(meta: { label: string; notice?: string }): string {
  return meta.notice === undefined ? meta.label : bare(meta.notice);
}
