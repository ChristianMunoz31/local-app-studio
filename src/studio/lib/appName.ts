import { APP_NAME_RE, RESERVED_APP_NAMES, isWindowsDeviceName } from '@local-app-studio/runtime/spec/schema';

export const NAME_MAX = 40;
export const NAME_MAX_WORDS = 2;
export const FALLBACK_NAME = 'My app';

export const NAME_STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a an the i im id ive me my mine we our ours us you your it its this that these those to for of in on at by with from about into ' +
    'and or but so as is are be been was were will would can could should want wants need needs like please help helps let lets make makes ' +
    'build create simple small little basic quick easy new app apps application applications tool tools program software system thing things ' +
    'something some way keep keeping track tracking manage managing organize organise see show list lists where which who what when how all ' +
    'every each just also then there here have has get do does use using lot lots more one ones'
  ).split(' '),
);

const ACRONYM_RE = /^[A-Z]{2,5}$/;
const CAPITALISED_RE = /^(?:[A-Z][a-z0-9]+|[A-Z]{2,5})$/;
export const NAME_RUN_MIN = 2;
export const NAME_RUN_MAX = 4;

const usable = (name: string): boolean =>
  name.length >= 2 && name.length <= NAME_MAX && APP_NAME_RE.test(name) && !RESERVED_APP_NAMES.has(name.toLowerCase()) && !isWindowsDeviceName(name);

/**
 * The person's own name for the thing, when the words hold one: the first run of 2 to 4 capitalised words ("Green Acre Landscaping")
 * that stays inside one piece of a sentence (a comma, bracket or full stop ends it) and holds no everyday word ("For", "The").
 * A single capitalised word is not a name: a sentence starts with one. Null when there is no such run or it is not a valid name.
 */
function capitalisedRun(text: string): string | null {
  for (const sentence of text.split(/[.!?;:\n]+/)) {
    for (const piece of sentence.split(/[,()]/)) {
      let run: string[] = [];
      const close = (): string | null => {
        const name = run.join(' ');
        const ok = run.length >= NAME_RUN_MIN && run.length <= NAME_RUN_MAX && usable(name);
        run = [];
        return ok ? name : null;
      };
      for (const raw of piece.trim().split(/\s+/)) {
        const word = raw.replace(/[^A-Za-z0-9]/g, '');
        if (CAPITALISED_RE.test(word) && !NAME_STOPWORDS.has(word.toLowerCase())) {
          run.push(word);
          continue;
        }
        const found = close();
        if (found !== null) return found;
      }
      const found = close();
      if (found !== null) return found;
    }
  }
  return null;
}

function caseWord(word: string): string {
  if (ACRONYM_RE.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Shortens `stem` (dropping last words, then cutting) so `stem + suffix` fits NAME_MAX. */
function fit(stem: string, suffix: string): string {
  let words = stem.split(' ');
  while (words.length > 1 && `${words.join(' ')}${suffix}`.length > NAME_MAX) words = words.slice(0, -1);
  const joined = words.join(' ');
  if (`${joined}${suffix}`.length <= NAME_MAX) return joined;
  return joined.slice(0, NAME_MAX - suffix.length).trimEnd();
}

/** `name` itself when no app has it (case-insensitive), else the first free "name 2", "name 3" that still fits NAME_MAX. */
export function uniqueAppName(name: string, takenNames: readonly string[] = []): string {
  const taken = new Set(takenNames.map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n <= 999; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${fit(name, suffix)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

/** Derives a short valid app name from a plain description, unique (case-insensitive) among `takenNames`. */
export function deriveAppName(description: string, takenNames: readonly string[] = []): string {
  const s = description.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // The person's own name for it ("Green Acre Landscaping") beats the first two words that matter.
  const own = capitalisedRun(s);
  if (own !== null) return uniqueAppName(own, takenNames);
  // Apostrophes are dropped inside a word, so "Don't" stays one word ("Dont") instead of splitting into "Don".
  const wordsOf = (part: string): string[] =>
    part
      .replace(/['\u2019]/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length >= 2 && !NAME_STOPWORDS.has(w.toLowerCase()));
  let words = s.split(/[.!?;:\n]+/).map(wordsOf).find((w) => w.length > 0) ?? [];
  while (words.length > 0 && /^[0-9]/.test(words[0] ?? '')) words = words.slice(1);
  words = words.slice(0, NAME_MAX_WORDS).map(caseWord);

  let base = words.join(' ');
  if (words.length === 1 && base.length > NAME_MAX) base = base.slice(0, NAME_MAX);
  while (base.length > NAME_MAX && words.length > 1) {
    words = words.slice(0, -1);
    base = words.join(' ');
  }
  if (!usable(base)) base = FALLBACK_NAME;

  return uniqueAppName(base, takenNames);
}
