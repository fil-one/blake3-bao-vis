import type { ReactNode } from 'react';

export function Section({
  n,
  title,
  description,
  children,
}: {
  n: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`section-${n}`} className="card flex scroll-mt-20 flex-col gap-5">
      <header className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">
          {n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-medium text-zinc-950">{title}</h2>
          {description && <p className="text-ui text-zinc-600">{description}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
