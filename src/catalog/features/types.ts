// Feature records (docs/FEATURES.md). Pure types: erasable TypeScript, relative .ts imports (ADR-006).
import type { FieldType, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';

export const PARAM_TYPES = ['text', 'table', 'source', 'page', 'field'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export interface FeatureParam {
  /** ID_RE, max 24, not a reserved field id, unique in the feature. */
  name: string;
  /** Shown in Design's form. */
  label: string;
  type: ParamType;
  /** Required for type source, absent otherwise. */
  mode?: 'list' | 'record';
  /** Required for type field: the name of a table or source param of this feature. */
  of?: string;
  /** Optional for type field: non-empty, unique. */
  fieldTypes?: FieldType[];
}

export interface FeatureBinding {
  /** A param name. */
  param: string;
  /** A layer id inside the fragment. */
  layer: string;
  /** "children" or "props.<a>[.<b>...]". */
  target: string;
}

export interface FeatureBody {
  params: FeatureParam[];
  fragment: LayoutLayer;
  bindings: FeatureBinding[];
}

export interface FeatureDefinition extends FeatureBody {
  id: string;
  label: string;
  description: string;
  version: number;
  updatedAt: string;
}

export type FeatureLibrary = ReadonlyMap<string, FeatureDefinition>;

export interface FeatureNodeProps {
  featureId: string;
  params: Record<string, string>;
}

export type { FeatureMarker } from '@local-app-studio/runtime/spec/schema.ts';
