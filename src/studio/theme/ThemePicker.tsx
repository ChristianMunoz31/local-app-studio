// Picks the look of an app: Plain (a pearl sheet), one of the built-in themes (or the old "Classic" look while no theme is chosen), then an
// optional accent color, corner size and starting mode. Native radios throughout, so arrow keys and screen readers work.
// Plain words only: the user never sees an id or a setting name.
import { useId } from 'react';
import { Check } from 'lucide-react';
import SegmentedRadio from '@/components/settings/SegmentedRadio';
import type { Theme, ThemeOverrides } from '@local-app-studio/runtime/spec/schema.ts';
import { THEME_IDS } from '@local-app-studio/runtime/theme/ids.ts';
import type { ThemeId } from '@local-app-studio/runtime/theme/ids.ts';
import { hslToRgb, rgbString } from '@local-app-studio/runtime/theme/color.ts';
import { sanitizeTheme } from '@local-app-studio/runtime/theme/sanitize.ts';
import { withThemeId } from '@local-app-studio/runtime/theme/resolve.ts';
import { isPlainTheme, withPlainTheme } from '@local-app-studio/runtime/theme/plain.ts';
import { CLASSIC_LABEL, THEMES } from '@local-app-studio/runtime/theme/themes.ts';
import { HINT_CLASS } from '../components/ui';
import ThemeSwatch from './ThemeSwatch';

export interface ThemePickerProps {
  value: Theme;
  onChange(next: Theme): void;
  idPrefix?: string;
}

/** The fixed accent choices: whole-number hues with a plain color name. */
const ACCENTS: ReadonlyArray<{ hue: number; label: string }> = [
  { hue: 0, label: 'Red' },
  { hue: 25, label: 'Orange' },
  { hue: 45, label: 'Gold' },
  { hue: 140, label: 'Green' },
  { hue: 175, label: 'Teal' },
  { hue: 205, label: 'Sky' },
  { hue: 250, label: 'Blue' },
  { hue: 285, label: 'Purple' },
  { hue: 330, label: 'Pink' },
];

const CORNERS = [
  { value: 'default', label: 'Theme default' },
  { value: 'none', label: 'Square' },
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Round' },
];

const MODES = [
  { value: 'default', label: 'Theme default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const FOCUS =
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:[outline-color:var(--focus-ring)]';
const LEGEND = 'mb-2 text-sm font-semibold text-slate-slate100';
const CLASSIC = 'classic';
const PLAIN = 'plain';
/** The words under a theme tile: its description, then how it starts (its own mode, before the app's Starts as choice). */
const STARTS = { dark: 'Starts dark.', light: 'Starts light.' } as const;
const themeDescription = (theme: { description: string; mode: 'light' | 'dark' }): string => `${theme.description}. ${STARTS[theme.mode]}`;

/** `next` overrides with the key set, or removed when `value` is undefined; `undefined` when nothing is left. */
function withOverride<K extends keyof ThemeOverrides>(overrides: ThemeOverrides | undefined, key: K, value: ThemeOverrides[K] | undefined): ThemeOverrides | undefined {
  const next: ThemeOverrides = { ...overrides };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length === 0 ? undefined : next;
}

export default function ThemePicker({ value, onChange, idPrefix }: ThemePickerProps) {
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const settings = sanitizeTheme(value);
  const hasTheme = settings.id !== null;
  const plain = isPlainTheme(settings);
  const selected: string = settings.id ?? (plain ? PLAIN : CLASSIC);

  const setOverrides = (overrides: ThemeOverrides | undefined): void => {
    const next: Theme = { ...value };
    delete next.overrides;
    onChange(overrides === undefined ? next : { ...next, overrides });
  };

  const pickPlain = (): void => {
    if (!plain) onChange(withPlainTheme(value));
  };

  const pickTheme = (id: ThemeId): void => {
    if (id === settings.id) return;
    // withThemeId drops the overrides; the accent, the corners and Starts as are the person's choices, so they stay across looks.
    const next = withThemeId(value, id);
    onChange(value.overrides === undefined ? next : { ...next, overrides: value.overrides });
  };

  const accentValue = settings.accentHue === null ? 'default' : String(settings.accentHue);

  return (
    <div className="space-y-5" data-testid="theme-picker">
      <fieldset className="min-w-0">
        <legend className={LEGEND}>Look</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[PLAIN, ...(hasTheme || plain ? [] : [CLASSIC]), ...THEME_IDS].map((id) => {
            const isPlain = id === PLAIN;
            const isClassic = id === CLASSIC;
            const isFixed = isPlain || isClassic;
            const label = isPlain ? 'Plain' : isClassic ? CLASSIC_LABEL : THEMES[id as ThemeId].label;
            const description = isPlain ? 'White and simple' : isClassic ? 'The standard look' : themeDescription(THEMES[id as ThemeId]);
            const preview: Theme = isPlain ? withPlainTheme({ preset: value.preset, radius: value.radius }) : isClassic ? value : withThemeId({ preset: value.preset, radius: value.radius }, id as ThemeId);
            const checked = selected === id;
            return (
              <label key={id} className="block cursor-pointer">
                <input
                  type="radio"
                  name={`${prefix}-look`}
                  value={id}
                  checked={checked}
                  onChange={() => (isPlain ? pickPlain() : !isFixed && pickTheme(id as ThemeId))}
                  className="peer sr-only"
                />
                <span
                  className={`glass-subtle glass-hover block rounded-lg border-2 p-2 ${FOCUS} ${
                    checked ? 'border-[color:var(--focus-ring)] hover:border-[color:var(--focus-ring)]' : 'border-[color:var(--glass-border-strong)]'
                  }`}
                >
                  <ThemeSwatch theme={preview} mode={isFixed ? 'light' : THEMES[id as ThemeId].mode} size="sm" />
                  <span className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-slate-slate100">{label}</span>
                    {checked && <Check size={14} className="shrink-0 text-slate-slate100" aria-hidden="true" />}
                  </span>
                  <span className={`block ${HINT_CLASS}`}>{description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className={`mt-2 ${HINT_CLASS}`}>Changes show on the page right away. Save to keep them.</p>
      </fieldset>

      <fieldset className="min-w-0" disabled={!hasTheme}>
        <legend className={LEGEND}>Accent color</legend>
        <div className="flex flex-wrap gap-2">
          {[{ hue: -1, label: 'Theme color' }, ...ACCENTS].map((accent) => {
            const key = accent.hue < 0 ? 'default' : String(accent.hue);
            const checked = accentValue === key;
            return (
              <label key={key} className="block cursor-pointer">
                <input
                  type="radio"
                  name={`${prefix}-accent`}
                  value={key}
                  checked={checked}
                  onChange={() => setOverrides(withOverride(value.overrides, 'accentHue', accent.hue < 0 ? undefined : accent.hue))}
                  className="peer sr-only"
                />
                <span
                  className={`glass-subtle flex min-h-9 items-center gap-1.5 rounded-lg border-2 px-2 py-1 text-sm text-slate-slate100 ${FOCUS} ${
                    checked ? 'border-[color:var(--focus-ring)]' : 'border-[color:var(--glass-border-strong)]'
                  }`}
                >
                  {accent.hue >= 0 && (
                    <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: rgbString(hslToRgb(accent.hue, 0.7, 0.5)) }} />
                  )}
                  {accent.label}
                  {checked && <Check size={14} className="shrink-0" aria-hidden="true" />}
                </span>
              </label>
            );
          })}
        </div>
        {!hasTheme && <p className={`mt-1.5 ${HINT_CLASS}`}>Pick a theme first to change its color, corners and how it starts.</p>}
      </fieldset>

      {/* The five corner choices are wider than the shelf: the row wraps instead of cutting the last one off. */}
      <div className="[&>fieldset>div]:flex-wrap" data-testid="corners-row">
        <SegmentedRadio
          legend="Corners"
          name={`${prefix}-corners`}
          value={settings.radiusOverride ?? 'default'}
          disabled={!hasTheme}
          onChange={(next: string) => setOverrides(withOverride(value.overrides, 'radius', next === 'default' ? undefined : (next as ThemeOverrides['radius'])))}
          options={CORNERS}
          hint={undefined}
        />
      </div>

      <SegmentedRadio
        legend="Starts as"
        name={`${prefix}-mode`}
        value={settings.mode ?? 'default'}
        disabled={!hasTheme}
        onChange={(next: string) => setOverrides(withOverride(value.overrides, 'mode', next === 'default' ? undefined : (next as ThemeOverrides['mode'])))}
        options={MODES}
        hint="People using the app can switch between light and dark in its Settings."
      />
    </div>
  );
}
