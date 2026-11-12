import { APP_NAME_RE, ID_RE, RESERVED_APP_NAMES, RESERVED_ROUTE_SEGMENTS, isWindowsDeviceName } from '@local-app-studio/runtime/spec/schema';

const MAX_ID = 31;

/** An id from a label: lowercase a-z, 0-9 and "_", starting with a letter, at most 31 chars, unique and not reserved. */
export function toId(label: string, taken: ReadonlySet<string>, reserved: (id: string) => boolean): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') base = 'item';
  if (!/^[a-z]/.test(base)) base = `n_${base}`;
  base = base.slice(0, MAX_ID).replace(/_+$/g, '');
  const ok = (id: string): boolean => ID_RE.test(id) && !taken.has(id) && !reserved(id);
  if (ok(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_ID - suffix.length).replace(/_+$/g, '')}${suffix}`;
    if (ok(candidate)) return candidate;
  }
  return `${base.slice(0, MAX_ID - 6)}_${Date.now() % 100000}`;
}

/** Same rule as server/studio/specCheck.js deriveSlug: lowercase, spaces to "-". */
export function deriveSlug(name: string): string {
  return name.trim().toLowerCase().replace(/ +/g, '-');
}

/** A page route from a title: "/open-crews", never starting with a reserved segment, unique among `taken`. */
export function uniquePageRoute(title: string, taken: ReadonlySet<string>): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (slug === '') slug = 'page';
  if (RESERVED_ROUTE_SEGMENTS.has(slug)) slug = `${slug}-page`;
  let route = `/${slug}`;
  for (let n = 2; taken.has(route) && n < 1000; n += 1) route = `/${slug}-${n}`;
  return route;
}

/** Why an app name is not allowed, in plain words, or null. Mirrors server isValidAppName. */
export function appNameProblem(name: string): string | null {
  const rule = 'Use 2 to 40 letters, digits and single spaces, starting with a letter.';
  if (name !== name.trim() || name.length < 2 || name.length > 40 || !APP_NAME_RE.test(name)) return rule;
  if (RESERVED_APP_NAMES.has(name.toLowerCase())) return 'That name is reserved. Pick another name.';
  if (isWindowsDeviceName(name)) return 'That name is reserved on Windows. Pick another name.';
  return null;
}
