import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui-compatible Button primitive.
 * Structure and tokens follow shadcn conventions so future `shadcn add` components
 * drop in without rework.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[--color-primary] text-[--color-primary-foreground] hover:opacity-90',
        destructive:
          'bg-[--color-destructive] text-[--color-destructive-foreground] hover:opacity-90',
        outline:
          'border border-[--color-border] bg-[--color-background] hover:bg-[--color-accent] hover:text-[--color-accent-foreground]',
        secondary:
          'bg-[--color-secondary] text-[--color-secondary-foreground] hover:opacity-80',
        ghost: 'hover:bg-[--color-accent] hover:text-[--color-accent-foreground]',
        link: 'text-[--color-primary] underline-offset-4 hover:underline',
      },
      size: {
        // Minimum 44px touch targets — mobile-first (Bible §8.20).
        default: 'h-11 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-12 rounded-md px-8',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

export { Button, buttonVariants };
