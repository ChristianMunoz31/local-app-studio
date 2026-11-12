// Theme data: constants only, no logic. The resolver (resolve.ts) turns these into CSS variable values.
// Tone values are generated once from the kit's own palette (src/index.css): every tone keeps the kit step luminances, so
// the contrast the kit guarantees holds for each tone; src/theme/__tests__/themes.test.ts enforces the rules.
// Erasable TypeScript, relative ".ts" imports, no zod (this file reaches built apps through applyRoot.ts).
import type { Rgb } from './color.ts';
import type { RADII, THEME_PRESETS } from '../spec/schema.ts';
import type { ThemeId, ThemeMode } from './ids.ts';

export type Preset = (typeof THEME_PRESETS)[number];
export type Radius = (typeof RADII)[number];
export type ToneId = 'warm' | 'paper' | 'ink' | 'moss' | 'cool' | 'neutral';
export type FontId = 'inter' | 'system' | 'serif' | 'mono';
export type DensityId = 'compact' | 'regular' | 'comfortable';
export type SlateStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type StatusName = 'green' | 'red' | 'yellow' | 'orange' | 'cyan' | 'purple' | 'teal' | 'blue' | 'fuchsia' | 'amber';

export interface ToneMode {
  scale: Record<SlateStep, Rgb>;
  /** Page gradient stops: top left, middle, bottom right. */
  bodyBg: readonly [Rgb, Rgb, Rgb];
  bodyText: Rgb;
  /** Tint of the glass surface (`glass` class) and of the denser one (`glass-dense`). */
  glass: Rgb;
  dense: Rgb;
  /** Tint of input wells and subtle tiles. */
  well: Rgb;
  /** Border tint and inset highlight tint. */
  edge: Rgb;
  highlight: Rgb;
  /** Solid fallbacks (no backdrop blur): normal and strong. `surfaceStrong` also tints the strong and flat glass. */
  surface: Rgb;
  surfaceStrong: Rgb;
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  tone: ToneId;
  accent: { hue: number; chroma: 'none' | 'soft' | 'vivid' };
  background: Preset;
  radius: Radius;
  font: FontId;
  density: DensityId;
  /** The mode a built app starts in when nothing else says (the app's own choice in Settings wins once made). */
  mode: ThemeMode;
}

export const THEMES: Readonly<Record<ThemeId, ThemeDef>> = {
  slate: { id: 'slate', label: 'Slate', description: 'Calm and warm', tone: 'warm', accent: { hue: 248, chroma: 'soft' }, background: 'aurora', radius: 'md', font: 'inter', density: 'regular', mode: 'light' },
  paper: { id: 'paper', label: 'Paper', description: 'Light and bookish', tone: 'paper', accent: { hue: 18, chroma: 'soft' }, background: 'solid', radius: 'sm', font: 'serif', density: 'comfortable', mode: 'light' },
  midnight: { id: 'midnight', label: 'Midnight', description: 'Deep blue and dark', tone: 'ink', accent: { hue: 265, chroma: 'vivid' }, background: 'ocean', radius: 'lg', font: 'inter', density: 'regular', mode: 'dark' },
  forest: { id: 'forest', label: 'Forest', description: 'Green and natural', tone: 'moss', accent: { hue: 150, chroma: 'soft' }, background: 'forest', radius: 'md', font: 'system', density: 'regular', mode: 'dark' },
  sand: { id: 'sand', label: 'Sand', description: 'Warm and friendly', tone: 'warm', accent: { hue: 35, chroma: 'vivid' }, background: 'sunset', radius: 'lg', font: 'serif', density: 'comfortable', mode: 'light' },
  ocean: { id: 'ocean', label: 'Ocean', description: 'Fresh and blue', tone: 'cool', accent: { hue: 200, chroma: 'vivid' }, background: 'ocean', radius: 'md', font: 'system', density: 'regular', mode: 'light' },
  rose: { id: 'rose', label: 'Rose', description: 'Soft and pink', tone: 'neutral', accent: { hue: 340, chroma: 'soft' }, background: 'sunset', radius: 'lg', font: 'inter', density: 'comfortable', mode: 'light' },
  mono: { id: 'mono', label: 'Mono', description: 'Plain gray', tone: 'neutral', accent: { hue: 0, chroma: 'none' }, background: 'graphite', radius: 'none', font: 'mono', density: 'compact', mode: 'light' },
};

/** The three blob colors per background and mode, copied from `--mesh-<preset>-<mode>-<n>` in src/index.css. */
export const MESH: Readonly<Record<Preset, { dark: readonly [string, string, string]; light: readonly [string, string, string] }>> = {
  aurora: {
    dark: ['rgba(217, 152, 72, 0.16)', 'rgba(99, 102, 170, 0.20)', 'rgba(45, 160, 150, 0.14)'],
    light: ['rgba(165, 180, 252, 0.35)', 'rgba(125, 211, 252, 0.28)', 'rgba(253, 186, 140, 0.26)'],
  },
  ocean: {
    dark: ['rgba(56, 130, 200, 0.18)', 'rgba(80, 90, 180, 0.18)', 'rgba(40, 170, 190, 0.14)'],
    light: ['rgba(125, 190, 250, 0.34)', 'rgba(165, 180, 252, 0.28)', 'rgba(110, 220, 230, 0.26)'],
  },
  sunset: {
    dark: ['rgba(225, 110, 80, 0.16)', 'rgba(170, 70, 130, 0.18)', 'rgba(225, 150, 60, 0.12)'],
    light: ['rgba(253, 186, 140, 0.34)', 'rgba(251, 170, 200, 0.28)', 'rgba(252, 211, 120, 0.26)'],
  },
  forest: {
    dark: ['rgba(70, 160, 100, 0.16)', 'rgba(40, 130, 120, 0.18)', 'rgba(150, 160, 70, 0.12)'],
    light: ['rgba(134, 239, 172, 0.32)', 'rgba(110, 210, 190, 0.28)', 'rgba(190, 220, 150, 0.26)'],
  },
  graphite: {
    dark: ['rgba(190, 190, 190, 0.08)', 'rgba(150, 150, 160, 0.10)', 'rgba(200, 200, 200, 0.06)'],
    light: ['rgba(156, 163, 175, 0.30)', 'rgba(209, 213, 219, 0.30)', 'rgba(148, 163, 184, 0.24)'],
  },
  solid: {
    dark: ['transparent', 'transparent', 'transparent'],
    light: ['transparent', 'transparent', 'transparent'],
  },
};

/** Corner sizes per setting. `md` equals the kit values (tailwind.config.cjs borderRadius and the Tailwind defaults for xl and 2xl). */
export const RADIUS_SCALE: Readonly<Record<Radius, { sm: string; md: string; lg: string; xl: string; '2xl': string }>> = {
  none: { sm: '0rem', md: '0rem', lg: '0rem', xl: '0rem', '2xl': '0rem' },
  sm: { sm: '0.125rem', md: '0.25rem', lg: '0.5rem', xl: '0.5rem', '2xl': '0.75rem' },
  md: { sm: '0.1875rem', md: '0.375rem', lg: '0.875rem', xl: '0.75rem', '2xl': '1rem' },
  lg: { sm: '0.25rem', md: '0.5rem', lg: '1.125rem', xl: '1rem', '2xl': '1.5rem' },
};

const INTER = "'Inter', ui-sans-serif, system-ui, sans-serif";
const SYSTEM = "'Segoe UI', system-ui, -apple-system, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/** Local font stacks only (Inter and JetBrains Mono are bundled; the rest are installed with the computer). */
export const FONTS: Readonly<Record<FontId, { body: string; heading: string }>> = {
  inter: { body: INTER, heading: INTER },
  system: { body: SYSTEM, heading: SYSTEM },
  serif: { body: INTER, heading: SERIF },
  mono: { body: INTER, heading: MONO },
};

/** The `--spacing` base (kit: 0.25rem). */
export const DENSITY: Readonly<Record<DensityId, string>> = {
  compact: '0.22rem',
  regular: '0.25rem',
  comfortable: '0.28rem',
};

/** Status colors never change with the theme (a green stays a green): the kit `--acc-*` values, indigo excluded. */
export const STATUS_ACCENTS: { dark: Record<StatusName, Rgb>; light: Record<StatusName, Rgb> } = {
  dark: {
    green: [154, 224, 149], red: [255, 166, 193], yellow: [255, 214, 107], orange: [255, 182, 142], cyan: [136, 219, 255],
    purple: [191, 174, 252], teal: [116, 235, 225], blue: [160, 198, 255], fuchsia: [232, 121, 249], amber: [251, 191, 36],
  },
  light: {
    green: [4, 108, 78], red: [185, 28, 28], yellow: [180, 83, 9], orange: [194, 65, 12], cyan: [14, 116, 144],
    purple: [109, 40, 217], teal: [15, 118, 110], blue: [29, 78, 216], fuchsia: [162, 28, 175], amber: [180, 83, 9],
  },
};

/** The name shown for a spec with no theme id (the kit look). */
export const CLASSIC_LABEL = 'Classic';

/** The flat light page of the plain look (a pearly white). Not a tone step: the Slate light `scale[800]` stays the white card color. */
export const PEARL_PAGE: Rgb = [251, 249, 246];

export const TONES: Readonly<Record<ToneId, { dark: ToneMode; light: ToneMode }>> = {
  warm: {
    dark: {
      scale: { 50: [245, 238, 226], 100: [236, 228, 214], 200: [228, 219, 204], 300: [214, 203, 186], 400: [171, 158, 140], 500: [168, 155, 138], 600: [99, 88, 75], 700: [74, 65, 55], 800: [48, 42, 35], 900: [33, 28, 23], 950: [22, 19, 16] },
      bodyBg: [[52, 44, 36], [30, 26, 22], [22, 19, 16]],
      bodyText: [230, 223, 210],
      glass: [52, 45, 38],
      dense: [44, 38, 32],
      well: [22, 19, 16],
      edge: [255, 240, 220],
      highlight: [255, 245, 230],
      surface: [47, 41, 34],
      surfaceStrong: [40, 35, 29],
    },
    light: {
      scale: { 50: [17, 24, 39], 100: [31, 41, 55], 200: [55, 65, 81], 300: [75, 85, 99], 400: [90, 98, 112], 500: [107, 114, 128], 600: [209, 213, 219], 700: [229, 231, 235], 800: [255, 255, 255], 900: [249, 250, 251], 950: [243, 244, 246] },
      bodyBg: [[249, 250, 251], [243, 244, 246], [243, 244, 246]],
      bodyText: [31, 41, 55],
      glass: [255, 255, 255],
      dense: [255, 255, 255],
      well: [255, 255, 255],
      edge: [17, 24, 39],
      highlight: [255, 255, 255],
      surface: [255, 255, 255],
      surfaceStrong: [255, 255, 255],
    },
  },
  paper: {
    dark: {
      scale: { 50: [240, 238, 236], 100: [231, 229, 225], 200: [223, 220, 214], 300: [209, 203, 196], 400: [168, 159, 145], 500: [166, 156, 141], 600: [97, 88, 76], 700: [72, 65, 57], 800: [47, 43, 37], 900: [31, 28, 25], 950: [21, 20, 17] },
      bodyBg: [[49, 45, 38], [29, 27, 23], [21, 20, 17]],
      bodyText: [227, 223, 219],
      glass: [50, 45, 39],
      dense: [42, 39, 33],
      well: [21, 20, 17],
      edge: [246, 236, 223],
      highlight: [250, 244, 235],
      surface: [46, 42, 36],
      surfaceStrong: [39, 35, 31],
    },
    light: {
      scale: { 50: [29, 24, 13], 100: [49, 39, 22], 200: [78, 63, 35], 300: [102, 81, 46], 400: [112, 90, 50], 500: [131, 105, 59], 600: [225, 211, 188], 700: [238, 230, 217], 800: [251, 250, 247], 900: [248, 245, 239], 950: [244, 239, 230] },
      bodyBg: [[248, 245, 239], [244, 239, 230], [244, 239, 230]],
      bodyText: [49, 39, 22],
      glass: [253, 252, 251],
      dense: [253, 252, 251],
      well: [253, 252, 251],
      edge: [34, 28, 17],
      highlight: [255, 255, 255],
      surface: [253, 252, 251],
      surfaceStrong: [253, 252, 251],
    },
  },
  ink: {
    dark: {
      scale: { 50: [237, 238, 246], 100: [226, 228, 240], 200: [216, 219, 235], 300: [198, 204, 226], 400: [148, 158, 200], 500: [145, 156, 198], 600: [73, 87, 141], 700: [54, 64, 105], 800: [35, 41, 68], 900: [23, 28, 46], 950: [16, 19, 31] },
      bodyBg: [[37, 44, 71], [21, 26, 42], [16, 19, 31]],
      bodyText: [220, 223, 237],
      glass: [37, 44, 73],
      dense: [32, 37, 61],
      well: [16, 19, 31],
      edge: [223, 228, 246],
      highlight: [235, 238, 250],
      surface: [34, 40, 66],
      surfaceStrong: [29, 34, 56],
    },
    light: {
      scale: { 50: [19, 24, 36], 100: [32, 41, 60], 200: [51, 64, 95], 300: [66, 83, 123], 400: [74, 92, 137], 500: [86, 107, 159], 600: [206, 213, 228], 700: [227, 231, 240], 800: [252, 252, 253], 900: [246, 247, 250], 950: [239, 242, 247] },
      bodyBg: [[246, 247, 250], [239, 242, 247], [239, 242, 247]],
      bodyText: [32, 41, 60],
      glass: [254, 255, 255],
      dense: [254, 255, 255],
      well: [254, 255, 255],
      edge: [17, 22, 34],
      highlight: [255, 255, 255],
      surface: [254, 255, 255],
      surfaceStrong: [254, 255, 255],
    },
  },
  moss: {
    dark: {
      scale: { 50: [235, 240, 237], 100: [223, 231, 227], 200: [212, 223, 217], 300: [193, 208, 200], 400: [138, 166, 152], 500: [134, 164, 149], 600: [71, 94, 83], 700: [53, 70, 62], 800: [34, 45, 40], 900: [23, 31, 27], 950: [15, 20, 18] },
      bodyBg: [[37, 48, 42], [22, 29, 25], [15, 20, 18]],
      bodyText: [217, 226, 221],
      glass: [37, 49, 43],
      dense: [31, 42, 36],
      well: [15, 20, 18],
      edge: [223, 246, 235],
      highlight: [235, 250, 242],
      surface: [34, 44, 39],
      surfaceStrong: [28, 37, 33],
    },
    light: {
      scale: { 50: [18, 25, 21], 100: [31, 43, 36], 200: [50, 69, 57], 300: [65, 89, 75], 400: [71, 98, 83], 500: [84, 116, 97], 600: [202, 217, 208], 700: [224, 233, 228], 800: [252, 253, 252], 900: [245, 248, 246], 950: [238, 243, 240] },
      bodyBg: [[245, 248, 246], [238, 243, 240], [238, 243, 240]],
      bodyText: [31, 43, 36],
      glass: [254, 255, 254],
      dense: [254, 255, 254],
      well: [254, 255, 254],
      edge: [17, 34, 24],
      highlight: [255, 255, 255],
      surface: [254, 255, 254],
      surfaceStrong: [254, 255, 254],
    },
  },
  cool: {
    dark: {
      scale: { 50: [236, 239, 241], 100: [226, 230, 233], 200: [216, 220, 226], 300: [199, 205, 212], 400: [149, 161, 175], 500: [146, 158, 173], 600: [79, 90, 104], 700: [59, 67, 78], 800: [38, 44, 50], 900: [26, 30, 34], 950: [17, 19, 22] },
      bodyBg: [[40, 46, 52], [24, 27, 31], [17, 19, 22]],
      bodyText: [220, 224, 229],
      glass: [40, 46, 54],
      dense: [34, 39, 45],
      well: [17, 19, 22],
      edge: [223, 234, 246],
      highlight: [235, 242, 250],
      surface: [37, 43, 49],
      surfaceStrong: [32, 37, 42],
    },
    light: {
      scale: { 50: [19, 24, 30], 100: [32, 41, 51], 200: [51, 66, 80], 300: [67, 86, 106], 400: [74, 94, 115], 500: [86, 110, 135], 600: [205, 214, 223], 700: [226, 232, 237], 800: [253, 254, 254], 900: [247, 249, 250], 950: [241, 244, 246] },
      bodyBg: [[247, 249, 250], [241, 244, 246], [241, 244, 246]],
      bodyText: [32, 41, 51],
      glass: [254, 255, 255],
      dense: [254, 255, 255],
      well: [254, 255, 255],
      edge: [17, 26, 34],
      highlight: [255, 255, 255],
      surface: [254, 255, 255],
      surfaceStrong: [254, 255, 255],
    },
  },
  neutral: {
    dark: {
      scale: { 50: [239, 239, 239], 100: [229, 229, 229], 200: [220, 220, 220], 300: [205, 205, 205], 400: [160, 160, 160], 500: [157, 157, 157], 600: [89, 89, 89], 700: [66, 66, 66], 800: [42, 42, 42], 900: [28, 28, 28], 950: [19, 19, 19] },
      bodyBg: [[45, 45, 45], [26, 26, 26], [19, 19, 19]],
      bodyText: [224, 224, 224],
      glass: [46, 46, 46],
      dense: [38, 38, 38],
      well: [19, 19, 19],
      edge: [246, 223, 223],
      highlight: [250, 235, 235],
      surface: [41, 41, 41],
      surfaceStrong: [35, 35, 35],
    },
    light: {
      scale: { 50: [24, 24, 24], 100: [40, 40, 40], 200: [64, 64, 64], 300: [84, 84, 84], 400: [97, 97, 97], 500: [113, 113, 113], 600: [213, 213, 213], 700: [231, 231, 231], 800: [255, 255, 255], 900: [250, 250, 250], 950: [244, 244, 244] },
      bodyBg: [[250, 250, 250], [244, 244, 244], [244, 244, 244]],
      bodyText: [40, 40, 40],
      glass: [255, 255, 255],
      dense: [255, 255, 255],
      well: [255, 255, 255],
      edge: [34, 17, 17],
      highlight: [255, 255, 255],
      surface: [255, 255, 255],
      surfaceStrong: [255, 255, 255],
    },
  },
};
