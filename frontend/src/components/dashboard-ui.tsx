import type { ReactNode } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Search, type LucideIcon } from "lucide-react";

export function PageHeading({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="surface space-y-4 p-5" role="status" aria-label="Loading content" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="skeleton h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <div className="skeleton h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="surface flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertCircle size={19} />
      </span>
      <p className="text-sm font-semibold text-slate-800">We couldn’t load this information</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      {onRetry && <button className="button-secondary mt-4" onClick={onRetry}><RefreshCw size={14} /> Try again</button>}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <AlertCircle size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "green",
}: {
  icon: LucideIcon;
  label: string;
  value: string | null | undefined;
  helper: string;
  tone?: "green" | "amber" | "rose" | "slate";
}) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  }[tone];

  return (
    <article className="surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ring-1 ring-inset ${styles}`}>
          <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
        </span>
      </div>
      {value === null ? (
        <div className="skeleton mt-4 h-8 w-20" aria-hidden="true" />
      ) : (
        <p className="mt-3 text-[27px] font-semibold tracking-[-.04em] text-slate-900">{value ?? "—"}</p>
      )}
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{helper}</p>
    </article>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  className = "",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        className="field !pl-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block text-xs font-semibold text-slate-600 ${className}`}>
      {label}
      <select className="field mt-1.5" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
      <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button className="button-secondary !min-h-8 !px-2.5" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        <button className="button-secondary !min-h-8 !px-2.5" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function StatusBadge({ children, tone = "gray" }: { children: ReactNode; tone?: "green" | "yellow" | "red" | "gray" }) {
  const color = { green: "badge-green", yellow: "badge-yellow", red: "badge-red", gray: "badge-gray" }[tone];
  return <span className={`badge ${color}`}>{children}</span>;
}
