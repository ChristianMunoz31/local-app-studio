// The words of the Design status line for history: what a step did ("added Form after Table of records"), said again by Undo
// ("Undid: added Form after Table of records.") and by Redo. A step label is lower case and has no full stop. The Data step uses
// the same two lead words. Pure.
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { findLayer } from '../lib/layoutTree';
import { blockName } from './designLabels';

export const UNDID = 'Undid';
export const REDID = 'Redid';

/** "Undid: moved Tabs down." */
export const historyLine = (lead: typeof UNDID | typeof REDID, label: string): string => `${lead}: ${label}.`;

const lowerFirst = (text: string): string => (text === '' ? text : text[0].toLowerCase() + text.slice(1));
const upperFirst = (text: string): string => (text === '' ? text : text[0].toUpperCase() + text.slice(1));

/** The status line of a step: "Added Form after Table of records." */
export const sentenceOf = (label: string): string => `${upperFirst(label)}.`;

/** The label a status line implies: its first sentence, without the full stop, in lower case ("Put A beside B. Both take half." gives "put A beside B"). */
export function labelOf(text: string): string {
  const first = text.split(/\.\s/)[0].replace(/\.$/, '').trim();
  return lowerFirst(first);
}

/** What adding a part did, by where it went: "added Form after Table of records", "added Text at the top of the page", "added Text to Column 1 of 2". */
export function addedLabel(root: LayoutLayer, id: string, menuPosition: 'top' | 'side' = 'top'): string {
  const found = findLayer(root, id);
  if (found === null) return 'added a part';
  const name = blockName(found.layer, found.parent, menuPosition);
  const holder = found.parent;
  if (holder === null) return `added ${name}`;
  const kids = Array.isArray(holder.children) ? holder.children : [];
  const at = kids.findIndex((k) => k.id === id);
  if (at > 0) return `added ${name} after ${blockName(kids[at - 1], holder, menuPosition)}`;
  const holderFound = findLayer(root, holder.id);
  if (holderFound !== null && holderFound.parent === null) return `added ${name} at the top of the page`;
  return `added ${name} to ${blockName(holder, holderFound?.parent ?? null, menuPosition)}`;
}

/** Said when the Move to... list opens, and read with the group's name: the keyboard way to move has no other spoken line. */
export const movingWords = (name: string): string => `Moving ${name}. Pick a place.`;
/** Said when Enter or Space on the handle finds no other place for the block. */
export const noPlaceWords = (name: string): string => `There is no other place for ${name}.`;

/**
 * Where the Add here pill sits in its place: above the block it comes before, below the one it comes after, and above the row for the
 * bar between parts side by side. It is never drawn over the block, so it covers neither the table badge at the block's corner nor its words.
 */
export function pillAlign(position: 'before' | 'after' | 'fill', inline: boolean): string {
  if (position === 'fill') return 'items-center';
  if (inline || position === 'before') return 'items-start';
  return 'items-end';
}
