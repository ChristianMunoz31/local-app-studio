// The small types the part registry (registry.tsx) and its tests need: a registry entry per part and the layer tree a page
// stores. They were once imported from the vendored ui-builder; only these shapes are used.
import type { ComponentType } from 'react';
import type { PartPropsSchema } from './types.ts';

/** One page layer: a part (`type`), its stored props, and its children (layers, or text for text parts). */
export interface ComponentLayer {
  id: string;
  name?: string;
  type: string;
  props: Record<string, unknown>;
  children: ComponentLayer[] | string;
}

/** What a part's component receives: its parsed props plus children. */
export type RegistryComponent = ComponentType<Record<string, unknown>>;

/** One part in the registry. */
export interface RegistryEntry {
  component: RegistryComponent;
  /** The part's props schema, plus a `children` field for parts that have children. */
  schema: PartPropsSchema;
  /** Where the part lives (`@/catalog/parts/<Name>`); a part with no `from` would render as a plain DOM tag. */
  from?: string;
  /** What a newly added layer starts with: the default text for text parts, an empty list for containers. */
  defaultChildren: ComponentLayer[] | string;
  /** Parent part names this part may be added under; an empty list keeps it out of every add menu. */
  childOf?: string[];
}

/** Part name to registry entry. */
export type ComponentRegistry = Record<string, RegistryEntry>;
