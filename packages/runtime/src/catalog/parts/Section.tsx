import type { IconName } from '../../../../../src/catalog/enums.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { PART_ICONS } from './icons.ts';
import { SectionCard } from './kit.ts';
import { cx } from './styles.ts';

export interface SectionProps extends EditorProps {
  title?: string;
  subtitle?: string;
  icon?: IconName;
  variant?: 'card' | 'plain';
}

/** A titled block of parts: a kit card, or a plain heading over open content. */
export function Section({ title, subtitle, icon, variant = 'card', ...rest }: SectionProps) {
  const { className, ...dom } = editorDomProps(rest);
  const children = rest.children;
  const Icon = icon ? PART_ICONS[icon] : undefined;
  if (variant === 'card') {
    return (
      <div {...dom} className={className}>
        <SectionCard title={title} subtitle={subtitle} icon={Icon}>
          <div className="space-y-3">{children}</div>
        </SectionCard>
      </div>
    );
  }
  return (
    <div {...dom} className={cx('space-y-3', className)}>
      {(title || subtitle) && (
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} className="text-slate-slate400" aria-hidden="true" />}
          <div className="min-w-0">
            {title && <h3 className="font-[family-name:var(--font-display)] text-sm font-bold tracking-tight text-slate-slate100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-slate400">{subtitle}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
