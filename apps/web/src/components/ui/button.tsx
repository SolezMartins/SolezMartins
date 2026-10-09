import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
export const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: { default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90', secondary: 'bg-muted hover:bg-input', outline: 'bg-transparent hover:bg-muted', ghost: 'border-transparent bg-transparent hover:bg-muted', destructive: 'border-transparent bg-destructive text-white hover:bg-destructive/90' },
    size: { default: 'h-8 px-3', sm: 'h-7 px-2', icon: 'h-8 w-8 p-0' },
  }, defaultVariants: { variant: 'secondary', size: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p} />);
Button.displayName = 'Button';
