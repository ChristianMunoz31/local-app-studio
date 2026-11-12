// Prop types for the kit's JSX components (their props are inferred as all required from the destructuring).
declare module '@/components/shared/Modal.jsx' {
  import type { ComponentType, ReactNode, RefObject } from 'react';
  const Modal: ComponentType<{
    title: string;
    onClose: () => void;
    children?: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    role?: string;
    dismissible?: boolean;
    backdropDismiss?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    finalFocusRef?: RefObject<HTMLElement | null>;
    describedBy?: string;
    /** 'right' shows a full-height side sheet; default 'center'. */
    placement?: 'center' | 'right';
  }>;
  export default Modal;
}
declare module '@/components/shared/ConfirmDialog.jsx' {
  import type { ComponentType, ReactNode, RefObject } from 'react';
  const ConfirmDialog: ComponentType<{
    title: string;
    message: ReactNode;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
    finalFocusRef?: RefObject<HTMLElement | null>;
  }>;
  export default ConfirmDialog;
}
declare module '@/components/shared/AiUnavailable.jsx' {
  import type { ComponentType } from 'react';
  const AiUnavailable: ComponentType<{ message?: string; code?: string; reason?: string; link?: boolean; className?: string }>;
  export default AiUnavailable;
}
declare module '@/components/settings/SegmentedRadio.jsx' {
  import type { ComponentType } from 'react';
  const SegmentedRadio: ComponentType<{
    legend: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    hint?: string;
    name?: string;
    disabled?: boolean;
  }>;
  export default SegmentedRadio;
}
