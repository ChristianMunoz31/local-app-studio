// The pages a navigation part may link to, shared by NavLinks and the app menu bar. Tolerant of a spec that was not
// validated: anything that is not the expected shape is skipped. A page whose route holds a `:id` is never listed, because
// going there needs a record (it is reached from a list, not from a menu).
import type { LucideIcon } from 'lucide-react';
import type { AppSpec } from '../../spec/schema.ts';
import { PART_ICONS } from './icons.ts';

export interface NavEntry {
  pageId: string;
  label: string;
  /** The stored icon name, as is; `navIcon` says whether there is a glyph for it. */
  icon?: string;
}

type SpecLike = Pick<AppSpec, 'nav' | 'pages'> | null | undefined;

const hasParam = (route: string): boolean => route.split('/').some((segment) => segment.startsWith(':'));

function linkablePages(spec: SpecLike): Map<string, string> {
  const out = new Map<string, string>();
  for (const page of Array.isArray(spec?.pages) ? spec.pages : []) {
    if (typeof page?.id === 'string' && typeof page.route === 'string' && !hasParam(page.route)) out.set(page.id, typeof page.title === 'string' ? page.title : page.id);
  }
  return out;
}

function navItems(spec: SpecLike): Array<{ pageId: string; label: string; icon?: string }> {
  const out: Array<{ pageId: string; label: string; icon?: string }> = [];
  for (const item of Array.isArray(spec?.nav) ? spec.nav : []) {
    if (typeof item?.pageId === 'string' && typeof item.label === 'string') out.push({ pageId: item.pageId, label: item.label, icon: typeof item.icon === 'string' ? item.icon : undefined });
  }
  return out;
}

/** The menu items of the spec (`nav`) whose page exists and needs no record, in menu order. */
export function menuEntries(spec: SpecLike): NavEntry[] {
  const pages = linkablePages(spec);
  return navItems(spec).filter((item) => pages.has(item.pageId));
}

/** The named pages, in the order given: the label of the menu item for the page, else the page title. */
export function pageEntries(spec: SpecLike, pageIds: readonly string[] | undefined): NavEntry[] {
  const pages = linkablePages(spec);
  const items = navItems(spec);
  const out: NavEntry[] = [];
  for (const pageId of Array.isArray(pageIds) ? pageIds : []) {
    const title = pages.get(pageId);
    if (title === undefined || out.some((e) => e.pageId === pageId)) continue;
    const item = items.find((n) => n.pageId === pageId);
    out.push({ pageId, label: item?.label ?? title, icon: item?.icon });
  }
  return out;
}

/** The glyph for a stored icon name, or undefined for no icon or a name the catalog does not know. */
export function navIcon(name: string | undefined): LucideIcon | undefined {
  return name !== undefined && Object.hasOwn(PART_ICONS, name) ? PART_ICONS[name as keyof typeof PART_ICONS] : undefined;
}

/** The menu settings with the defaults for anything other than the two exact non-default values (stored data may be junk). */
export function menuLook(menu: unknown): { side: boolean; labelsOnly: boolean } {
  const block: Record<string, unknown> = menu !== null && typeof menu === 'object' && !Array.isArray(menu) ? (menu as Record<string, unknown>) : {};
  return { side: block.position === 'side', labelsOnly: block.style === 'labels' };
}
