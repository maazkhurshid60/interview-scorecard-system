import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
      'placeholder:text-muted-foreground',
      'focus-visible:border-[#d21e2b] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d21e2b]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
