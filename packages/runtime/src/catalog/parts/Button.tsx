import { btnPrimary, btnSecondary } from '../../../../../src/components/shared/formStyles.js';
import type { Action } from '../../../../../src/catalog/actions.ts';
import type { IconName } from '../../../../../src/catalog/enums.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { PART_ICONS } from './icons.ts';
import { cx } from './styles.ts';

// The danger variant is local to the catalog: the kit's btnDanger uses a fixed red, this one reads the theme's status color.
const DANGER_CLASS =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md border border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-red';
const VARIANT_CLASS = { primary: btnPrimary, secondary: btnSecondary, danger: DANGER_CLASS } as const;
// The kit button classes carry px-4 py-2 text-sm; the small size drops those three and adds its own.
const KIT_SPACING = /(?<![\w:-])(px-4|py-2|text-sm)(?![\w-])/g;
const SMALL_CLASS = 'px-3 py-1 text-xs';

export interface ButtonProps extends EditorProps {
  variant?: keyof typeof VARIANT_CLASS;
  size?: 'sm' | 'md';
  icon?: IconName;
  action?: Action;
}

/** A button that runs one declared action. A refusal ("Open a record first.") shows beside the button. */
export function Button({ variant = 'primary', size = 'md', icon, action, ...rest }: ButtonProps) {
  const { run, notice } = useNoticeAction();
  const { className, ...dom } = editorDomProps(rest);
  const Icon = icon ? PART_ICONS[icon] : undefined;
  const base = VARIANT_CLASS[variant];
  const classes = size === 'sm' ? `${base.replace(KIT_SPACING, '')} ${SMALL_CLASS}` : base;
  const onClick = (): void => {
    if (action) run(action);
  };
  return (
    <span {...dom} className={cx('inline-flex items-center gap-2', className)}>
      <button type="button" className={classes} onClick={onClick}>
        {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
        {rest.children}
      </button>
      <Notice text={notice} />
    </span>
  );
}
