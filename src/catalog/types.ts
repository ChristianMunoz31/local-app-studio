// The part contract (docs/CATALOG.md). Pure: imports only zod types and src/spec/schema.ts, follows the ADR-006 syntax
// rules (relative .ts imports, import type, no JSX, no "@/"), and is imported by the Studio server.
import type { z } from 'zod';
import type { FieldType, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import type { EditorProps } from '@local-app-studio/runtime/catalog/parts/editorProps.ts';

/** Built from the spec and the page being edited or generated. */
export interface PartContext {
  tableIds: string[];
  pageIds: string[];
  sourceIds: string[];
  sources: Record<string, { table: string; mode: 'list' | 'record' }>;
  /** By table id, runtime columns included. */
  fields: Record<string, { id: string; type: FieldType }[]>;
  /** The page route ends in /:id. */
  recordPage: boolean;
  /** Ids of the spec's pages whose route ends in /:id (action_needs_record checks). Absent: not checked. */
  recordPageIds?: string[];
}

export interface Binding {
  /** Dotted for nested props, for example "action.pageId". */
  prop: string;
  kind: 'source' | 'field' | 'fields' | 'table' | 'page';
  /** For field(s): the prop naming the source or table they belong to. */
  of?: string;
  /** For source. */
  mode?: 'list' | 'record';
  /** For field(s). */
  fieldTypes?: FieldType[];
  /** For field(s): only fields a user can edit (no created_at or updated_at). */
  editable?: boolean;
}

/** What every catalog component receives: the editor's props plus the part's own props, as stored in the layer. */
export type PartComponentProps = EditorProps & Record<string, unknown>;

/** A strict zod object: unknown props are rejected, ids are enums built from the context. */
export type PartPropsSchema = z.ZodObject<z.core.$ZodShape, z.core.$strict>;

export interface PartDefinition {
  /** PascalCase, equals layer.type. */
  name: string;
  group: 'layout' | 'data' | 'action';
  /** For the model, one or two sentences, at most 200 chars. */
  description: string;
  props: (ctx: PartContext) => PartPropsSchema;
  /** Props of the part when it sits in the app menu bar; absent: the same props as on a page. Binds are not checked there. */
  menuProps?: (ctx: PartContext) => PartPropsSchema;
  /**
   * Props a stored layer may carry, a superset of `props`; absent: `props`. The layout validator parses against this;
   * the helper is offered `props` only, so a prop here that is not in `props` is set in Design alone (ADR-012).
   */
  designProps?: (ctx: PartContext) => PartPropsSchema;
  children: 'none' | 'text' | 'parts';
  /** When children is 'parts'; omitted means any part except Page. */
  allowedChildren?: string[];
  /** Allowed parents; omitted means any part whose children are 'parts'. */
  childOf?: string[];
  /** When children is 'parts': how many children the part holds (checked by validateLayout and the page schema). */
  childCount?: { min: number; max: number };
  binds: Binding[];
  /** One valid example layer (ids included), shown to the model. */
  example: LayoutLayer;
  /** Default text for children 'text'. */
  textDefault?: string;
}

/** The context of the phase 1 spike: one page ("home"), no tables, no sources. */
export const SPIKE_PART_CONTEXT: PartContext = {
  tableIds: [],
  pageIds: ['home'],
  sourceIds: [],
  sources: {},
  fields: {},
  recordPage: false,
};
