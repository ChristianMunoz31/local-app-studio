import { Palette } from 'lucide-react';
import SectionCard from '../shared/SectionCard';
import { sectionProps } from './settingsSections';
import SegmentedRadio from './SegmentedRadio';
import BackgroundPicker from './BackgroundPicker';
import ResetControl from './ResetControl';

const LIGHT_DARK = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const THEME_OPTIONS = [{ value: 'system', label: 'System' }, ...LIGHT_DARK];

export default function AppearanceSection({
  preference,
  resolvedTheme,
  onPreferenceChange,
  bgDark,
  bgLight,
  onBgDarkChange,
  onBgLightChange,
  onReset,
  themeName,
  showBackgrounds = true,
}) {
  // A built app names its theme and offers only Light and Dark (no System); its background comes from the theme.
  const named = typeof themeName === 'string' && themeName !== '';
  return (
    <SectionCard
      {...sectionProps('appearance')}
      title="Appearance"
      subtitle={showBackgrounds ? 'Theme and page background. Changes apply immediately.' : 'Light or dark. Changes apply immediately.'}
      icon={Palette}
    >
      <div className="space-y-6">
        <SegmentedRadio
          legend="Theme"
          name="settings-theme"
          value={preference}
          onChange={onPreferenceChange}
          options={named ? LIGHT_DARK : THEME_OPTIONS}
          hint={
            named
              ? `This app uses the ${themeName} theme.`
              : preference === 'system'
                ? `Follows your device setting (currently ${resolvedTheme}).`
                : undefined
          }
        />
        {showBackgrounds && (
          <>
            <BackgroundPicker
              legend="Dark mode background"
              name="settings-bg-dark"
              value={bgDark}
              onChange={onBgDarkChange}
            />
            <BackgroundPicker
              legend="Light mode background"
              name="settings-bg-light"
              value={bgLight}
              onChange={onBgLightChange}
            />
            <p className="text-xs text-slate-slate400">
              Backgrounds are hidden while your system's reduced transparency or increased contrast
              setting is on.
            </p>
          </>
        )}
      </div>
      <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
        <ResetControl label="Appearance" onConfirm={onReset} />
      </div>
    </SectionCard>
  );
}
