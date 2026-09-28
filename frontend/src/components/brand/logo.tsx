import { cn } from '@/lib/utils';

/** The Omni.io mark: three rungs, widest first — the ladder degrading gracefully. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-7 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="14" className="fill-[#0f172a] dark:fill-[#1e293b]" />
      <rect x="14" y="17" width="36" height="8" rx="4" className="fill-tier-1" />
      <rect x="14" y="28" width="26" height="8" rx="4" className="fill-tier-2" />
      <rect x="14" y="39" width="16" height="8" rx="4" className="fill-tier-3" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-base font-bold tracking-tight">
        Omni<span className="text-tier-1">.</span>io
      </span>
    </span>
  );
}
