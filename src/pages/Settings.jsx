import { Suspense } from 'react';
import RouteBoundary from '../components/shared/RouteBoundary.jsx';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useSyncedSetting } from '../hooks/useSyncedSetting';
import {
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  normalizeAssistantAdvisorButton,
  normalizeAssistantAutoAdvise,
} from '../constants/settingsDefaults';
import { usePageContext } from '../contexts/PageContextContext';
import { buildSettingsContext } from '../utils/assistantBuilders/settings';
import AppearanceSection from '../components/settings/AppearanceSection';
import GeneralSection from '../components/settings/GeneralSection';
import AiSection from '../components/settings/AiSection';
import DataStorageSection from '../components/settings/DataStorageSection';
import PrivacyActivitySection from '../components/settings/PrivacyActivitySection';
import NetworkSection from '../components/settings/NetworkSection';
import ApiKeysSection from '../components/settings/ApiKeysSection';
import ResetControl from '../components/settings/ResetControl';
import SettingsLayout from '../components/settings/SettingsLayout';
import { SETTINGS_SECTIONS } from '../components/settings/settingsSections';
import LicenseSection from '../components/settings/LicenseSection';
import { MODULE_APP_BACKGROUND, MODULE_APP_THEME, MODULE_SETTINGS_SECTIONS, MODULE_SHELL } from '../modules';

// A module that owns the shell (a built app) lists the kit sections it shows; Studio shows them all.
const shown = (id) => MODULE_SHELL === null || MODULE_SHELL.kitSettings.includes(id);
// A module's own sections (About this app in a built app) join the section nav and the scroll spy after the kit's.
const SHOWN_SECTIONS = [
  ...SETTINGS_SECTIONS.filter((s) => shown(s.id)),
  ...MODULE_SETTINGS_SECTIONS.filter((s) => s.label && s.icon).map(({ id, label, icon }) => ({ id, label, icon })),
];

export default function Settings() {
  const toast = useToast();
  const { theme, preference, setPreference, bgDark, bgLight, setBgDark, setBgLight } = useTheme();
  const [storedAdvisorButton, setAdvisorButton] = useSyncedSetting(
    SETTINGS_KEYS.assistantAdvisorButton,
    SETTINGS_DEFAULTS.assistantAdvisorButton,
  );
  const [storedAutoAdvise, setAutoAdvise] = useSyncedSetting(
    SETTINGS_KEYS.assistantAutoAdvise,
    SETTINGS_DEFAULTS.assistantAutoAdvise,
  );
  const advisorButton = normalizeAssistantAdvisorButton(storedAdvisorButton);
  const autoAdvise = normalizeAssistantAutoAdvise(storedAutoAdvise);

  usePageContext('settings', () =>
    buildSettingsContext({
      themePreference: preference,
      advisorButton,
      autoAdvise,
    }),
  );

  // Values apply locally at once; saving to the data file is best-effort. One error toast
  // per user action (a reset saves several keys) when the save fails.
  const saveOptions = () => {
    let shown = false;
    return {
      onError: () => {
        if (shown) return;
        shown = true;
        toast({
          message: "Couldn't save settings. Changes are kept on this device only.",
          type: 'error',
        });
      },
    };
  };
  const withSave = (setter) => (value) => setter(value, saveOptions());

  const resetAppearance = (opts) => {
    setPreference(SETTINGS_DEFAULTS.theme, opts);
    setBgDark(MODULE_APP_BACKGROUND ?? SETTINGS_DEFAULTS.bgDark, opts);
    setBgLight(MODULE_APP_BACKGROUND ?? SETTINGS_DEFAULTS.bgLight, opts);
  };

  const resetGeneral = (opts) => {
    setAdvisorButton(SETTINGS_DEFAULTS.assistantAdvisorButton, opts);
    setAutoAdvise(SETTINGS_DEFAULTS.assistantAutoAdvise, opts);
  };

  const done = (label, fn) => () => {
    fn(saveOptions());
    toast({ message: `${label} reset to defaults.`, type: 'success' });
  };

  const resetAll = () => {
    const opts = saveOptions();
    resetAppearance(opts);
    resetGeneral(opts);
    toast({ message: 'All settings reset to defaults.', type: 'success' });
  };

  return (
    <SettingsLayout sections={SHOWN_SECTIONS}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-slate100 tracking-tight">Settings</h2>
          <p className="text-sm text-slate-slate400 mt-1">
            {MODULE_SHELL?.settingsIntro ?? 'Appearance, assistant options, data, privacy and licensing. Saved on this computer.'}
          </p>
        </div>
        <div className="flex max-w-xs flex-col items-end gap-1.5">
          <ResetControl label="all settings" triggerText="Reset all to defaults" onConfirm={resetAll} />
          <p className="text-right text-xs text-slate-slate400">
            {MODULE_SHELL?.settingsResetNote ?? 'Does not change your AI model choices or connected services.'}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {shown('appearance') && (
          <AppearanceSection
            preference={preference}
            resolvedTheme={theme}
            onPreferenceChange={withSave(setPreference)}
            bgDark={bgDark}
            bgLight={bgLight}
            onBgDarkChange={withSave(setBgDark)}
            onBgLightChange={withSave(setBgLight)}
            onReset={done('Appearance', resetAppearance)}
            themeName={MODULE_APP_THEME?.name}
            showBackgrounds={MODULE_APP_THEME === null}
          />
        )}
        {shown('general') && (
          <GeneralSection
            advisorButton={advisorButton}
            onAdvisorButtonChange={withSave(setAdvisorButton)}
            autoAdvise={autoAdvise}
            onAutoAdviseChange={withSave(setAutoAdvise)}
            onReset={done('General', resetGeneral)}
          />
        )}
        {shown('ai') && <AiSection />}
        {shown('data-storage') && <DataStorageSection />}
        {shown('privacy') && <PrivacyActivitySection />}
        {shown('network') && <NetworkSection />}
        {shown('api-keys') && <ApiKeysSection />}
        {shown('license') && <LicenseSection />}
        {MODULE_SETTINGS_SECTIONS.map(({ id, Component }) => (
          <RouteBoundary key={id} variant="section">
            <Suspense fallback={null}>
              <Component />
            </Suspense>
          </RouteBoundary>
        ))}
      </div>
    </SettingsLayout>
  );
}
