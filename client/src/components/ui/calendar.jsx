import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

function Calendar({ className, classNames, ...props }) {
  return (
    <DayPicker
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'relative flex flex-col gap-3',
        month_caption: 'flex justify-center items-center h-8',
        caption_label: 'text-sm font-medium text-foreground',
        button_previous:
          'absolute left-1 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30',
        button_next:
          'absolute right-1 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30',
        month_grid: 'w-full border-collapse',
        weekday: 'w-9 pb-2 text-center text-xs font-medium text-muted-foreground',
        day: 'p-0.5 text-center text-sm relative',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
        today: '[&>button]:font-semibold [&>button]:text-[#d21e2b]',
        selected: '[&>button]:bg-[#d21e2b] [&>button]:text-white [&>button]:hover:bg-[#d21e2b]/90',
        range_start: '[&>button]:bg-[#d21e2b] [&>button]:text-white [&>button]:hover:bg-[#d21e2b]/90',
        range_end: '[&>button]:bg-[#d21e2b] [&>button]:text-white [&>button]:hover:bg-[#d21e2b]/90',
        range_middle: '[&>button]:bg-[#d21e2b]/15 [&>button]:text-foreground [&>button]:rounded-none',
        outside: 'text-muted-foreground/40',
        disabled: 'text-muted-foreground/30',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === 'left'
            ? <ChevronLeft className="h-4 w-4" {...chevronProps} />
            : <ChevronRight className="h-4 w-4" {...chevronProps} />,
      }}
      {...props}
    />
  );
}

export { Calendar };
