// The catalog as a part registry (docs/CATALOG.md, "Mapping a part to a registry entry"): one entry per part, with its
// component, props schema and where it may be added. UI only: the pure files never import this.
import * as z from 'zod';
import { PART_DEFINITIONS } from './definitions.ts';
import { PART_COMPONENTS } from './components.ts';
import type { ComponentRegistry, RegistryComponent, RegistryEntry } from './registryTypes.ts';
import type { PartContext, PartDefinition } from './types.ts';

// Each component takes the part's parsed props plus children; the registry only ever renders them with those.
const COMPONENTS: Readonly<Record<string, RegistryComponent>> = PART_COMPONENTS as unknown as Readonly<Record<string, RegistryComponent>>;

function entryFor(def: PartDefinition, ctx: PartContext): RegistryEntry {
  const props = def.props(ctx);
  // Children go through the schema: text parts take a string, container parts any layers.
  const schema =
    def.children === 'text' ? props.extend({ children: z.string() }) : def.children === 'parts' ? props.extend({ children: z.unknown().optional() }) : props;
  return {
    component: COMPONENTS[def.name],
    schema,
    from: `@/catalog/parts/${def.name}`,
    defaultChildren: def.children === 'text' ? (def.textDefault ?? '') : [],
    ...(def.childOf ? { childOf: def.childOf } : {}),
  };
}

let last: { key: string; registry: ComponentRegistry } | null = null;

/**
 * The registry for a context. Memoized: the same context content returns the same object, so the editor store is not
 * re-initialized by a re-render.
 */
export function buildRegistry(ctx: PartContext): ComponentRegistry {
  const key = JSON.stringify(ctx);
  if (last?.key === key) return last.registry;
  const registry: ComponentRegistry = Object.fromEntries(PART_DEFINITIONS.map((def) => [def.name, entryFor(def, ctx)]));
  last = { key, registry };
  return registry;
}
