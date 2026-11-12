// Top-level path segment ("/apps/new" -> "/apps"); used as the content key.
export function routeKey(pathname) {
  return `/${pathname.split('/')[1] ?? ''}`;
}
