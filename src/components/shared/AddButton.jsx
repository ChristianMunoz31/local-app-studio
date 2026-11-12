import { Plus } from 'lucide-react';

/** Primary "add" trigger that opens a dialog. `ref` is a plain prop (React 19). */
export default function AddButton({ label, onClick, ref, ...rest }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-brand text-white hover:bg-slate-brandDark focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
      {...rest}
    >
      <Plus size={14} />
      {label}
    </button>
  );
}
