import type { ElementType, ReactNode } from 'react';

const VARIANT_CLASS = {
  default: 'glass',
  dense: 'glass-dense',
} as const;

export interface StudioSectionCardProps {
  title?: string;
  subtitle?: string;
  icon?: ElementType;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  variant?: keyof typeof VARIANT_CLASS;
  id?: string;
  headingId?: string;
}

/**
 * The Studio's section card.
 *
 * The shared `components/shared/SectionCard.jsx` is also the built apps' card (the runtime catalog and the app template ship it),
 * so its look must not change with the Studio. This card has the same props and glass classes, but its header wraps (a wide
 * action drops under the title instead of crushing it), the title wraps instead of truncating, and the icon never squashes.
 */
export default function StudioSectionCard({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = '',
  variant = 'default',
  id,
  headingId,
}: StudioSectionCardProps) {
  return (
    <div id={id} className={`${VARIANT_CLASS[variant] ?? VARIANT_CLASS.default} rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div
          data-testid="studio-section-card-header"
          className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2${children ? ' mb-4' : ''}`}
        >
          <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
            {Icon && <Icon size={16} className="shrink-0 text-slate-slate400" />}
            <div className="min-w-0">
              {title && (
                <h3
                  id={headingId}
                  tabIndex={headingId ? -1 : undefined}
                  className="text-sm font-bold text-slate-slate100 tracking-tight break-words focus:outline-hidden"
                >
                  {title}
                </h3>
              )}
              {subtitle && <p className="text-xs text-slate-slate400 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action && (
            <div data-testid="studio-section-card-action" className="ml-auto min-w-0 max-w-full">
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
