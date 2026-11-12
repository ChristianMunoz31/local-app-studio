// Typed views of the kit's plain JSX components, for TypeScript callers (the kit itself stays JavaScript). Each type is
// only the part of the component's API the TypeScript code uses.
import type { FunctionComponent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import KitConfirmDialog from '../../../../../src/components/shared/ConfirmDialog.jsx';
import KitModal from '../../../../../src/components/shared/Modal.jsx';
import KitSectionCard from '../../../../../src/components/shared/SectionCard.jsx';
import { Skeleton as KitSkeleton } from '../../../../../src/components/shared/Skeleton.jsx';

export const SectionCard = KitSectionCard as FunctionComponent<{
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  children?: ReactNode;
}>;

export const Modal = KitModal as FunctionComponent<{
  title: string;
  onClose: () => void;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}>;

export const ConfirmDialog = KitConfirmDialog as FunctionComponent<{
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}>;

export const Skeleton = KitSkeleton as FunctionComponent<{ className?: string }>;
