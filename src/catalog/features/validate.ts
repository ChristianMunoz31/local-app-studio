// Validation of a feature record before it is stored or imported (docs/FEATURES.md, "Rules the checks enforce").
// Pure. Stops after shape errors; otherwise reports every problem found, then proves the feature on the sample app.
import type { LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema.ts';
import { FIELD_TYPES, ID_RE, LABEL_RE, LayoutLayerSchema, isReservedFieldId, isReservedTableId } from '@local-app-studio/runtime/spec/schema.ts';
import { getPartDefinition } from '../definitions.ts';
import { CONTROL_RE, readFeatureNode } from './expand.ts';
import { FEATURE_LIMITS, FEATURE_TYPE } from './limits.ts';
import { sampleSpecFor } from './sample.ts';
import { slotsOf } from './slots.ts';
import { PARAM_TYPES } from './types.ts';
import type { FeatureBinding, FeatureBody, FeatureLibrary, FeatureParam } from './types.ts';

/** Feature ids follow the table id rules and reserved words. */
export const isReservedFeatureId: (id: string) => boolean = isReservedTableId;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const issue = (path: string, code: string, message: string): SpecIssue => ({ path, code, message });
const hasOnly = (o: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

interface Walked {
  layer: LayoutLayer;
  depth: number;
  path: string;
}

function walkFragment(root: LayoutLayer): Walked[] {
  const out: Walked[] = [];
  const stack: Walked[] = [{ layer: root, depth: 1, path: 'fragment' }];
  for (let w = stack.pop(); w !== undefined; w = stack.pop()) {
    out.push(w);
    if (Array.isArray(w.layer.children)) {
      for (let i = w.layer.children.length - 1; i >= 0; i -= 1) {
        stack.push({ layer: w.layer.children[i], depth: w.depth + 1, path: `${w.path}.children.${i}` });
      }
    }
  }
  return out;
}

/** The feature ids a body places, via Feature nodes of its fragment. */
function nestedIds(body: FeatureBody): string[] {
  return walkFragment(body.fragment)
    .filter((w) => w.layer.type === FEATURE_TYPE && typeof w.layer.props.featureId === 'string')
    .map((w) => w.layer.props.featureId as string);
}

/** A chain of feature ids that returns to `id` (for example ["a","b","a"]), or null. */
export function findCycle(id: string, body: FeatureBody, lib: FeatureLibrary): string[] | null {
  const bodyOf = (fid: string): FeatureBody | undefined => (fid === id ? body : lib.get(fid));
  const visit = (fid: string, trail: string[]): string[] | null => {
    const b = bodyOf(fid);
    if (b === undefined) return null;
    for (const next of nestedIds(b)) {
      if (next === id) return [...trail, fid, next];
      if (trail.includes(next) || next === fid) continue;
      const found = visit(next, [...trail, fid]);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(id, []);
}

/** Levels of nesting below a feature, itself included (a feature with no nested one is 1). Assumes no cycle. */
function nestDepth(fid: string, body: FeatureBody, id: string, lib: FeatureLibrary, guard = 0): number {
  if (guard > 10) return guard;
  let max = 0;
  for (const next of nestedIds(body)) {
    const b = next === id ? body : lib.get(next);
    if (b !== undefined) max = Math.max(max, nestDepth(next, b, id, lib, guard + 1));
  }
  return 1 + max;
}

function checkParams(raw: unknown, out: SpecIssue[]): FeatureParam[] {
  if (!Array.isArray(raw)) {
    out.push(issue('params', 'invalid_feature', 'params must be a list.'));
    return [];
  }
  if (raw.length > FEATURE_LIMITS.params) out.push(issue('params', 'invalid_feature', `A feature takes at most ${FEATURE_LIMITS.params} parameters.`));
  const params: FeatureParam[] = [];
  const names = new Set<string>();
  raw.forEach((p: unknown, i) => {
    const at = `params.${i}`;
    if (!isPlain(p) || !hasOnly(p, ['name', 'label', 'type', 'mode', 'of', 'fieldTypes'])) {
      out.push(issue(at, 'invalid_feature', 'A parameter is { name, label, type, mode?, of?, fieldTypes? }.'));
      return;
    }
    const { name, label, type, mode, of, fieldTypes } = p;
    if (typeof name !== 'string' || !ID_RE.test(name) || name.length > FEATURE_LIMITS.paramNameChars) {
      out.push(issue(`${at}.name`, 'invalid_feature', `A parameter name is a-z, 0-9 and _, starts with a letter, at most ${FEATURE_LIMITS.paramNameChars} characters.`));
    } else if (isReservedFieldId(name)) {
      out.push(issue(`${at}.name`, 'reserved_word', `"${name}" is a reserved word. Pick another parameter name.`));
    } else if (names.has(name)) {
      out.push(issue(`${at}.name`, 'duplicate_param', `Parameter "${name}" is used twice.`));
    } else {
      names.add(name);
    }
    if (typeof label !== 'string' || label.length < 1 || label.length > FEATURE_LIMITS.labelChars || !LABEL_RE.test(label)) {
      out.push(issue(`${at}.label`, 'invalid_feature', `A parameter label is 1 to ${FEATURE_LIMITS.labelChars} characters with no leading or trailing space.`));
    }
    if (typeof type !== 'string' || !(PARAM_TYPES as readonly string[]).includes(type)) {
      out.push(issue(`${at}.type`, 'invalid_param', `A parameter type is one of: ${PARAM_TYPES.join(', ')}.`));
      return;
    }
    if (type === 'source' ? mode !== 'list' && mode !== 'record' : mode !== undefined) {
      out.push(issue(`${at}.mode`, 'invalid_param', 'mode is "list" or "record" and belongs to source parameters only.'));
    }
    if (type === 'field' ? typeof of !== 'string' : of !== undefined) {
      out.push(issue(`${at}.of`, 'invalid_param', 'of names a table or source parameter and belongs to field parameters only.'));
    }
    if (fieldTypes !== undefined) {
      const ok =
        type === 'field' &&
        Array.isArray(fieldTypes) &&
        fieldTypes.length > 0 &&
        new Set(fieldTypes).size === fieldTypes.length &&
        fieldTypes.every((t) => (FIELD_TYPES as readonly unknown[]).includes(t));
      if (!ok) out.push(issue(`${at}.fieldTypes`, 'invalid_param', 'fieldTypes is a non-empty list of different field types and belongs to field parameters only.'));
    }
    params.push(p as unknown as FeatureParam);
  });
  for (const [i, p] of params.entries()) {
    if (p.type !== 'field' || typeof p.of !== 'string') continue;
    const target = params.find((q) => q.name === p.of);
    if (target === undefined || target === p || (target.type !== 'table' && target.type !== 'source')) {
      out.push(issue(`params.${i}.of`, 'invalid_param', `"${p.of}" must be the name of a table or source parameter of this feature.`));
    }
  }
  return params;
}

/** Checks a feature record. `replacingId` is the id being edited (its stored body is ignored in cycle checks). */
export function validateFeatureInput(
  input: unknown,
  lib: FeatureLibrary,
  opts: { replacingId?: string } = {},
): { ok: true; value: FeatureBody & { id: string; label: string; description: string } } | { ok: false; issues: SpecIssue[] } {
  let data: unknown;
  try {
    data = JSON.parse(JSON.stringify(input));
  } catch {
    return { ok: false, issues: [issue('', 'invalid_feature', 'A feature must be plain JSON.')] };
  }
  if (!isPlain(data) || !hasOnly(data, ['id', 'label', 'description', 'params', 'fragment', 'bindings'])) {
    return { ok: false, issues: [issue('', 'invalid_feature', 'A feature is { id, label, description, params, fragment, bindings }.')] };
  }
  const issues: SpecIssue[] = [];
  const { id, label, description } = data;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    issues.push(issue('id', 'invalid_feature', 'The id is a-z, 0-9 and _, starts with a letter, at most 31 characters.'));
  } else if (isReservedFeatureId(id)) {
    issues.push(issue('id', 'reserved_word', `"${id}" is a reserved word. Pick another name.`));
  }
  if (typeof label !== 'string' || label.length < 1 || label.length > FEATURE_LIMITS.labelChars || !LABEL_RE.test(label) || CONTROL_RE.test(label)) {
    issues.push(issue('label', 'invalid_feature', `The label is 1 to ${FEATURE_LIMITS.labelChars} characters on one line, with no leading or trailing space.`));
  }
  if (typeof description !== 'string' || description.length < 1 || description.length > FEATURE_LIMITS.descriptionChars || !LABEL_RE.test(description) || CONTROL_RE.test(description)) {
    issues.push(issue('description', 'invalid_feature', `The description is 1 to ${FEATURE_LIMITS.descriptionChars} characters on one line.`));
  }
  const params = checkParams(data.params, issues);
  const rawBindings = data.bindings;
  if (!Array.isArray(rawBindings)) issues.push(issue('bindings', 'invalid_feature', 'bindings must be a list.'));
  let fragment: LayoutLayer | null = null;
  if (JSON.stringify(data.fragment ?? null).length > FEATURE_LIMITS.fragmentJsonChars) {
    issues.push(issue('fragment', 'fragment_too_large', `The fragment may be at most ${FEATURE_LIMITS.fragmentJsonChars} characters of JSON.`));
  } else {
    const parsed = LayoutLayerSchema.safeParse(data.fragment);
    if (parsed.success) fragment = parsed.data;
    else issues.push(issue('fragment', 'invalid_fragment', `The fragment is not a valid part: ${parsed.error.issues[0]?.message ?? 'unreadable'}.`));
  }
  if (issues.length > 0 || fragment === null || !Array.isArray(rawBindings) || typeof id !== 'string') return { ok: false, issues };

  // Fragment shape.
  const walked = walkFragment(fragment);
  if (walked.length > FEATURE_LIMITS.fragmentLayers) {
    issues.push(issue('fragment', 'fragment_too_large', `A feature may hold at most ${FEATURE_LIMITS.fragmentLayers} parts.`));
  }
  if (walked.some((w) => w.depth > FEATURE_LIMITS.fragmentDepth)) {
    issues.push(issue('fragment', 'fragment_too_large', `A feature may nest parts at most ${FEATURE_LIMITS.fragmentDepth} levels deep.`));
  }
  const rootDef = getPartDefinition(fragment.type);
  if (fragment.type === 'Page' || fragment.type === 'Tab' || fragment.type === FEATURE_TYPE || rootDef?.childOf !== undefined) {
    issues.push(issue('fragment.type', 'invalid_fragment', `The top part cannot be ${fragment.type}. Use a part that can sit inside a page, such as Section.`));
  }
  const ids = new Set<string>();
  for (const w of walked) {
    if (ids.has(w.layer.id)) issues.push(issue(`${w.path}.id`, 'invalid_fragment', `Part id "${w.layer.id}" is used twice.`));
    ids.add(w.layer.id);
    if (w.layer.feature !== undefined) {
      issues.push(issue(`${w.path}.feature`, 'invalid_fragment', 'Nested features are saved as Feature parts, not as marked blocks.'));
    }
    if (w.layer.type === FEATURE_TYPE) {
      const node = readFeatureNode(w.layer, w.path);
      if (!node.ok) issues.push(...node.issues);
      else if (node.featureId !== id && !lib.has(node.featureId)) {
        issues.push(issue(`${w.path}.props.featureId`, 'unknown_feature', `There is no feature "${node.featureId}".`));
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // Bindings.
  if (rawBindings.length > FEATURE_LIMITS.bindings) {
    issues.push(issue('bindings', 'invalid_binding', `A feature may have at most ${FEATURE_LIMITS.bindings} bindings.`));
  }
  const byId = new Map(walked.map((w) => [w.layer.id, w.layer]));
  const bindings: FeatureBinding[] = [];
  const bound = new Map<string, FeatureBinding>();
  const used = new Set<string>();
  // Slots of Feature nodes come from the referenced feature's params; this record stands in for itself (and for the stored one).
  const slotLib: FeatureLibrary = new Map(lib).set(id, {
    id,
    label: label as string,
    description: description as string,
    version: 1,
    updatedAt: '',
    params,
    fragment,
    bindings: [],
  });
  rawBindings.forEach((raw: unknown, i) => {
    const at = `bindings.${i}`;
    if (!isPlain(raw) || !hasOnly(raw, ['param', 'layer', 'target']) || typeof raw.param !== 'string' || typeof raw.layer !== 'string' || typeof raw.target !== 'string') {
      issues.push(issue(at, 'invalid_binding', 'A binding is { param, layer, target }, all text.'));
      return;
    }
    const b = raw as unknown as FeatureBinding;
    const param = params.find((p) => p.name === b.param);
    const layer = byId.get(b.layer);
    if (param === undefined) return void issues.push(issue(`${at}.param`, 'invalid_binding', `There is no parameter "${b.param}".`));
    if (layer === undefined) return void issues.push(issue(`${at}.layer`, 'invalid_binding', `There is no part "${b.layer}" in the fragment.`));
    const slot = slotsOf(layer, slotLib).find((s) => s.target === b.target);
    if (slot === undefined) {
      return void issues.push(issue(`${at}.target`, 'invalid_binding', `${layer.type} has no place "${b.target}" that a parameter may fill.`));
    }
    if (slot.kind !== param.type) {
      return void issues.push(issue(`${at}.target`, 'invalid_binding', `"${b.target}" of ${layer.type} takes ${slot.kind}, but "${param.name}" is ${param.type}.`));
    }
    if (slot.mode !== undefined && param.mode !== slot.mode) {
      return void issues.push(issue(`${at}.target`, 'invalid_binding', `"${b.target}" of ${layer.type} needs a ${slot.mode} source, but "${param.name}" is a ${param.mode ?? 'list'} source.`));
    }
    if (slot.kind === 'field' && slot.fieldTypes !== undefined) {
      const fits = param.fieldTypes !== undefined && param.fieldTypes.every((t) => slot.fieldTypes?.includes(t));
      if (!fits) {
        return void issues.push(issue(`${at}.target`, 'invalid_binding', `"${b.target}" of ${layer.type} takes ${slot.fieldTypes.join(', ')} fields, so "${param.name}" needs fieldTypes inside that list.`));
      }
    }
    const key = `${b.layer} ${b.target}`;
    if (bound.has(key)) return void issues.push(issue(at, 'invalid_binding', `${b.layer} ${b.target} is bound twice.`));
    bound.set(key, b);
    used.add(param.name);
    bindings.push(b);
  });
  for (const [i, b] of bindings.entries()) {
    const param = params.find((p) => p.name === b.param);
    const layer = byId.get(b.layer);
    if (param?.type !== 'field' || layer === undefined) continue;
    const slot = slotsOf(layer, slotLib).find((s) => s.target === b.target);
    const ofBinding = slot?.of === undefined ? undefined : bound.get(`${b.layer} ${slot.of}`);
    if (ofBinding?.param !== param.of) {
      issues.push(issue(`bindings.${i}`, 'invalid_binding', `"${param.name}" belongs to "${param.of}", so the place it fills must sit next to a place bound to "${param.of}".`));
    }
  }
  for (const p of params) {
    if (!used.has(p.name)) issues.push(issue('params', 'invalid_param', `Parameter "${p.name}" is not used by any binding.`));
  }
  for (const w of walked) {
    for (const slot of slotsOf(w.layer, slotLib)) {
      if (slot.kind !== 'text' && slot.kind !== 'fields' && typeof slot.value === 'string' && !bound.has(`${w.layer.id} ${slot.target}`)) {
        issues.push(
          issue(
            `${w.path}.${slot.target}`,
            'unbound_slot',
            `${w.layer.type} keeps the ${slot.kind} "${slot.value}" from the app it came from. Bind it to a ${slot.kind} parameter${slot.kind === 'field' ? ' or leave it out' : ''}.`,
          ),
        );
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // Cycles and nesting, with this body in place of the stored one.
  const body: FeatureBody = { params, fragment, bindings };
  const cycle = findCycle(id, body, lib);
  if (cycle !== null) {
    return { ok: false, issues: [issue('fragment', 'feature_cycle', `A feature cannot contain itself: ${cycle.join(' -> ')}.`)] };
  }
  if (nestDepth(id, body, id, lib) > FEATURE_LIMITS.nestDepth) {
    return { ok: false, issues: [issue('fragment', 'feature_too_deep', `Features may be nested at most ${FEATURE_LIMITS.nestDepth} levels deep.`)] };
  }

  // The sample check: the feature must work as a whole on a sample app.
  const withoutOld: FeatureLibrary = new Map([...lib].filter(([k]) => k !== (opts.replacingId ?? id)));
  const sample = sampleSpecFor(body, withoutOld, { id, label: label as string });
  if ('issues' in sample) {
    const keep = (code: string): boolean => code.startsWith('feature_') || code === 'unknown_feature' || code === 'invalid_binding';
    return {
      ok: false,
      issues: sample.issues
        .slice(0, 5)
        .map((s) => issue(s.path.replace(/^pages\.2\.layout\.children\.0/, 'fragment'), keep(s.code) ? s.code : 'invalid_fragment', s.message)),
    };
  }
  return { ok: true, value: { id, label: label as string, description: description as string, ...body } };
}
