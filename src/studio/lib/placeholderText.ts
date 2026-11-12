// Save as feature: a Text part that still holds the word a new Text part starts with. Pure.
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';

/** Said when a part of the selection still reads the word Text that a new Text part starts with. */
export const PLACEHOLDER_WARNING = 'A part still reads "Text". Change its words first, or the saved feature will show "Text".';

/** True when a Text part in the layer still holds its starting word. */
export function hasPlaceholderText(layer: LayoutLayer): boolean {
  if (layer.type === 'Text' && layer.children === 'Text') return true;
  return Array.isArray(layer.children) && layer.children.some(hasPlaceholderText);
}
