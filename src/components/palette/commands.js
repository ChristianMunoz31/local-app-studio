import { NAV_GROUPS } from '../shell/navItems';

// Build "Go to {module}" navigation commands from the single nav source of
// truth. The hint is the item's category name (direct links such as Home and Settings have none).
export function buildNavCommands({ navigate }) {
  return NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ item, hint: group.section ?? undefined })),
  ).map(({ item, hint }) => ({
    id: `nav:${item.to}`,
    label: `Go to ${item.label}`,
    hint,
    icon: item.icon,
    group: 'Navigate',
    run: () => navigate(item.to),
  }));
}
