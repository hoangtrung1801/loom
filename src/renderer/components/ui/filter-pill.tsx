import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** A toggleable filter chip: quiet outline when off, soft brand tint when on. */
export function FilterPill({ pressed, className, ...props }: React.ComponentProps<'button'> & { pressed: boolean }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      aria-pressed={pressed}
      className={cn(
        'h-6 rounded-full border border-border px-2.5 font-normal text-muted-foreground hover:bg-accent hover:text-foreground',
        'aria-pressed:border-brand/30 aria-pressed:bg-brand-soft aria-pressed:font-medium aria-pressed:text-brand-text',
        className,
      )}
      {...props}
    />
  );
}
