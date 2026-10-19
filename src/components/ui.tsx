import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: {
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx('button', `button--${variant}`, size === 'sm' && 'button--sm', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export function Input({ className, invalid, ...rest }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({
  className,
  invalid,
  ...rest
}: { invalid?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('input input--mono', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={clsx('text-xs font-medium text-zinc-900', className)}>
      {children}
    </label>
  );
}

/** A labelled control with the sentence underneath that explains or refuses it. */
export function Field({
  label,
  htmlFor,
  description,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : description ? (
        <p className="text-xs text-zinc-600">{description}</p>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, label, className }: { value: number; label?: string; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={clsx('h-2 w-full overflow-hidden rounded-full bg-zinc-100', className)}
    >
      <div className="h-full rounded-full bg-brand-700 transition-all duration-150" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** A read-only value in monospace with a copy button: CIDs, keys, headers. */
export function Mono({ value, label, placeholder }: { value?: string; label: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code
          className={clsx(
            'min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-ui',
            value ? 'text-zinc-900' : 'text-zinc-400',
          )}
          title={value}
        >
          {value || placeholder || '–'}
        </code>
        {value && <CopyButton value={value} />}
      </div>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value);
      }}
      aria-label="Copy"
    >
      Copy
    </Button>
  );
}

export type VerdictState = 'idle' | 'pending' | 'ok' | 'fail';

/** The banner that reports a verification: the demo's punchline, so it is
 * sized to be read from the back of the room. */
export function Verdict({
  state,
  okText = 'Verification Success',
  failText = 'Verification Failed',
  pendingText = 'Verifying',
}: {
  state: VerdictState;
  okText?: string;
  failText?: string;
  pendingText?: string;
}) {
  if (state === 'idle') return null;
  if (state === 'pending') {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-600">
        <Spinner /> <span>{pendingText}</span>
      </p>
    );
  }
  return (
    <p
      role="status"
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-4 py-3 text-xl font-medium',
        state === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800',
      )}
    >
      <span aria-hidden className="text-2xl leading-none">
        {state === 'ok' ? '✅' : '❌'}
      </span>
      {/* An element, not a bare text node: Firefox gives a text node that is
          a flex item a zero-size box here and never paints it. */}
      <span>{state === 'ok' ? okText : failText}</span>
    </p>
  );
}

/** A key/value row for response details. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium text-zinc-600">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-ui text-zinc-900">{children}</dd>
    </div>
  );
}
