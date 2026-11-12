// Small word helpers shared by askOutcome and notMade (DESIGN-phase17.md P17-02, P17-03). Pure, no React. A word is compared by its
// stem, so "Clients", "client" and "CLIENTS" are one word; this is a comparison aid, never shown to a person.

const IRREGULAR: Readonly<Record<string, string>> = { people: 'person', children: 'child', men: 'man', women: 'woman' };

/** The lower case words of a text, apostrophes dropped ("don't" is "dont"). */
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/['’]/g, '').match(/[a-z0-9]+/g) ?? [];
}

/** The singular form of an English word as far as a comparison needs ("jobs" and "job", "companies" and "company", "people" and "person"). */
export function stem(word: string): string {
  const w = word.toLowerCase();
  const irregular = IRREGULAR[w];
  if (irregular !== undefined) return irregular;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(status|bonus|campus|virus|focus|census|corpus)es$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** The stems of the words of a text, in order. */
export const stemsOf = (text: string): string[] => tokens(text).map(stem);

/** True when every word of `label` is among `words` (stems), so a longer text mentions the label. An empty label never matches. */
export function mentions(words: ReadonlySet<string>, label: string): boolean {
  const own = stemsOf(label);
  return own.length > 0 && own.every((s) => words.has(s));
}
