import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui-compatible Input primitive.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        // h-11 keeps the touch target >= 44px and text-base prevents iOS zoom-on-focus.
        'flex h-11 w-full rounded-md border border-[--color-input] bg-[--color-background] px-3 py-2 text-base ring-offset-[--color-background] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[--color-muted-foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
