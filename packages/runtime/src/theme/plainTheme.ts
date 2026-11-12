// The plain look as theme settings: no id and no overrides, the `solid` background. No imports, so the server
// (the Describe pipeline) can use it without the tone data of plain.ts. Erasable TypeScript.
/** `theme` as the plain look: no id and no overrides, the `solid` background, the corners kept. */
export function withPlainTheme<T extends { preset: string; radius: string }>(
  theme: T,
): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (key !== "id" && key !== "overrides") next[key] = value;
  }
  next.preset = "solid";
  return next as T;
}
