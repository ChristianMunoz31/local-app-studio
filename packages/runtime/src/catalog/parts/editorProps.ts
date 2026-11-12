// The only props a catalog part forwards to the DOM besides its own declared ones. The vendored editor injects exactly
// these into a part (render-utils.tsx: data-testid and data-layer-id on every part, and the class "relative" on a
// container while drop zones show). Everything else a layer carries in `props` (dangerouslySetInnerHTML, on* handlers,
// href, src, style, a class name) is dropped: a layout is data, and stored data must never become markup or script.
import type { ReactNode } from 'react';

export interface EditorProps {
  className?: string;
  children?: ReactNode;
  'data-testid'?: string;
  'data-layer-id'?: string;
}

/** The class names the editor itself may add to a part. A class name from layer props never gets past this list. */
const EDITOR_CLASSES: ReadonlySet<string> = new Set(['relative']);

/** The DOM props to spread on a part's root element: the editor's data attributes and its own classes, nothing else. */
export function editorDomProps(props: EditorProps): { className?: string; 'data-testid'?: string; 'data-layer-id'?: string } {
  const out: { className?: string; 'data-testid'?: string; 'data-layer-id'?: string } = {};
  const testId = props['data-testid'];
  const layerId = props['data-layer-id'];
  if (typeof testId === 'string') out['data-testid'] = testId;
  if (typeof layerId === 'string') out['data-layer-id'] = layerId;
  if (typeof props.className === 'string') {
    const kept = props.className.split(/\s+/).filter((name) => EDITOR_CLASSES.has(name));
    if (kept.length > 0) out.className = kept.join(' ');
  }
  return out;
}
