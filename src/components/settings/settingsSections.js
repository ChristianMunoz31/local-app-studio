import { BadgeCheck, Cpu, Database, Globe, KeyRound, Palette, ShieldCheck, SlidersHorizontal } from 'lucide-react';

// Page order. Icons match the SectionCard header of each section component.
export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI', icon: Cpu },
  { id: 'data-storage', label: 'Data & storage', icon: Database },
  { id: 'privacy', label: 'Privacy & activity', icon: ShieldCheck },
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'api-keys', label: 'Connected services', icon: KeyRound },
  { id: 'license', label: 'License', icon: BadgeCheck },
];

export const sectionHeadingId = (id) => `${id}-heading`;

// Props spread onto SectionCard: anchor id, focusable heading id, and a scroll margin that
// clears the sticky top bar (--topbar-h) plus, below md, the ~60px sticky section pill bar and
// an 8px gap. Keep in sync with the spy rootMargin in SettingsLayout.jsx: a clicked section lands
// at topbar + scroll-margin (md+: 1.5rem) while sections are 1rem apart, so the previous section's
// bottom sits at topbar + 0.5rem. The desktop spy band therefore starts at topbar + 1rem, which
// excludes that sliver and keeps the clicked section the topmost visible one.
export const sectionProps = (id) => ({
  id,
  headingId: sectionHeadingId(id),
  className:
    'scroll-mt-[calc(var(--topbar-h)_+_68px)] md:scroll-mt-[calc(var(--topbar-h)_+_1.5rem)]',
});
