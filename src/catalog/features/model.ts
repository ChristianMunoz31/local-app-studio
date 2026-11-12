// What the model is told about the library (docs/FEATURES.md, "For the model"). Pure.
import type { PartContext } from '../types.ts';
import { FEATURE_LIMITS } from './limits.ts';
import type { FeatureDefinition, FeatureLibrary, FeatureParam } from './types.ts';

export interface ModelFeature {
  id: string;
  description: string;
  params: { name: string; words: string }[];
}

/** The plain words for one parameter, for the prompt. */
function wordsFor(p: FeatureParam): string {
  if (p.type === 'text') return 'text';
  if (p.type === 'table') return 'table id';
  if (p.type === 'source') return p.mode === 'record' ? 'record source id' : 'list source id';
  if (p.type === 'page') return 'page id';
  return `field id of ${p.of ?? 'its table'}`;
}

/** Whether the page can supply a value for every param of the feature. */
function fillable(def: FeatureDefinition, ctx: PartContext): boolean {
  const tablesOf = (p: FeatureParam): string[] => {
    const target = def.params.find((q) => q.name === p.of);
    if (target?.type === 'table') return ctx.tableIds;
    if (target?.type === 'source') {
      return ctx.sourceIds.filter((id) => ctx.sources[id].mode === (target.mode ?? 'list')).map((id) => ctx.sources[id].table);
    }
    return [];
  };
  return def.params.every((p) => {
    if (p.type === 'text') return true;
    if (p.type === 'table') return ctx.tableIds.length > 0;
    if (p.type === 'page') return ctx.pageIds.length > 0;
    if (p.type === 'source') return ctx.sourceIds.some((id) => ctx.sources[id].mode === (p.mode ?? 'list'));
    return tablesOf(p).some((t) => (Object.hasOwn(ctx.fields, t) ? ctx.fields[t] : []).some((f) => p.fieldTypes === undefined || p.fieldTypes.includes(f.type)));
  });
}

function cut(text: string): string {
  const max = FEATURE_LIMITS.modelDescriptionChars;
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}...`;
}

/**
 * Features whose params can all be filled in ctx, newest updatedAt first, then id; at most 6; descriptions cut to 100
 * characters at the last space before the limit, plus "...".
 */
export function modelFeaturesFor(lib: FeatureLibrary, ctx: PartContext): ModelFeature[] {
  return [...lib.values()]
    .filter((d) => fillable(d, ctx))
    .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, FEATURE_LIMITS.modelFeatures)
    .map((d) => ({ id: d.id, description: cut(d.description), params: d.params.map((p) => ({ name: p.name, words: wordsFor(p) })) }));
}
