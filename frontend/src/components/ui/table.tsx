import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export const TableHeader = ({ className, ...props }: ComponentProps<'thead'>) => <thead className={cn('[&_tr]:border-b', className)} {...props} />;
export const TableBody = ({ className, ...props }: ComponentProps<'tbody'>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
export const TableRow = ({ className, ...props }: ComponentProps<'tr'>) => (
  <tr className={cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)} {...props} />
);
export const TableHead = ({ className, ...props }: ComponentProps<'th'>) => (
  <th className={cn('h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-muted-foreground', className)} {...props} />
);
export const TableCell = ({ className, ...props }: ComponentProps<'td'>) => <td className={cn('p-2 align-middle', className)} {...props} />;
