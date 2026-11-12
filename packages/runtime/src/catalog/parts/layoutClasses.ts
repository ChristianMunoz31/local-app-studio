// Literal Tailwind class tables of the layout parts (Columns, Row). Every class is written out in full so the build sees it;
// a stored value that is not a key falls back to the default instead of reaching the page. Gaps are `calc(var(--spacing) * n)`,
// so the theme's density applies. No colors here.

export const GAP_CLASS = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const;

/** The class for a stored value: an own key of the table, else the default's class (never a prototype member). */
export function pickClass<T extends Record<string, string>>(table: T, key: unknown, fallback: keyof T): string {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : table[fallback];
}
