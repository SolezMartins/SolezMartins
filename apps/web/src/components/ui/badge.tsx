import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const badge = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium', {
  variants: { tone: { neutral: 'border-border text-muted-foreground', bull: 'border-bull/30 bg-bull/10 text-bull', bear: 'border-bear/30 bg-bear/10 text-bear', warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400' } },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) { return <span className={cn(badge({ tone }), className)} {...p} />; }
