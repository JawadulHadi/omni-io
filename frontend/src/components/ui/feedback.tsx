import { AlertCircle, Info, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Alert({ variant = 'default', title, children, className }: { variant?: 'default' | 'destructive'; title?: string; children?: ReactNode; className?: string }) {
  const Icon = variant === 'destructive' ? AlertCircle : Info;
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border px-4 py-3 text-sm',
        variant === 'destructive' ? 'border-destructive/40 text-destructive' : 'bg-card',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4" aria-hidden />
      {title && <div className="font-medium">{title}</div>}
      {children && <div className={cn('text-muted-foreground', !title && 'col-start-2', variant === 'destructive' && 'text-destructive/90')}>{children}</div>}
    </div>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />;
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
