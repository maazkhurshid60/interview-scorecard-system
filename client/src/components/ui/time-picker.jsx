import * as React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Time picker. By default it always shows a time (10:00 AM when none is given).
 * With `allowEmpty`, an empty `value` means "no time chosen": nothing is selected, and
 * onChange fires only once hour, minute and AM/PM have all been picked.
 */
export function TimePicker({ value = '10:00', onChange, className, allowEmpty = false }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ hour12: null, minute: null, period: null });
  const hourRef = React.useRef(null);
  const minuteRef = React.useRef(null);
  const isEmpty = allowEmpty && !value;

  const parseTime = (val) => {
    if (!val) return { hour12: '10', minute: '00', period: 'AM' };
    const [h, m] = val.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return {
      hour12: String(hour12).padStart(2, '0'),
      minute: String(m || 0).padStart(2, '0'),
      period,
    };
  };

  const { hour12, minute, period } = isEmpty ? draft : parseTime(value);

  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        hourRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        minuteRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const emitChange = (h12, min, p) => {
    let h24 = parseInt(h12, 10);
    if (p === 'PM' && h24 < 12) h24 += 12;
    if (p === 'AM' && h24 === 12) h24 = 0;
    const formatted = `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    onChange?.(formatted);
  };

  // Picks one part (hour, minute or period). While no time is chosen yet, the parts are kept
  // aside and the time is only reported once all three are set.
  const choose = (part, val) => {
    const next = { hour12, minute, period, [part]: val };
    if (next.hour12 == null || next.minute == null || next.period == null) {
      setDraft(next);
      return;
    }
    setDraft({ hour12: null, minute: null, period: null });
    emitChange(next.hour12, next.minute, next.period);
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  const nothingChosen = isEmpty && hour12 == null && minute == null && period == null;
  const displayString = nothingChosen
    ? 'Select time'
    : `${hour12 ?? '--'}:${minute ?? '--'} ${period ?? '--'}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('w-full justify-start text-left font-normal bg-white border-slate-200 hover:bg-slate-50', !value && 'text-muted-foreground', className)}
        >
          <Clock className="mr-2 h-4 w-4 text-slate-400" />
          <span className={nothingChosen ? 'text-muted-foreground' : 'text-slate-800 font-medium'}>{displayString}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3.5 shadow-xl bg-white border border-slate-200 rounded-xl" align="start">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-brand" /> Select Time
            </span>
            <span className="text-xs font-bold text-brand bg-brand/10 px-2 py-0.5 rounded">
              {displayString}
            </span>
          </div>

          <div className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 p-2.5 bg-white shadow-inner">
            {/* Hours Column */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Hour</span>
              <div className="h-36 overflow-y-auto w-full flex flex-col gap-1 items-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {hours.map((h) => (
                  <Button
                    key={h}
                    ref={h === hour12 ? hourRef : null}
                    type="button"
                    size="sm"
                    variant={h === hour12 ? 'default' : 'ghost'}
                    className={cn(
                      'h-8 w-10 text-xs p-0 font-medium rounded-md transition-all shrink-0',
                      h === hour12
                        ? 'bg-brand text-white font-semibold shadow-sm hover:bg-brand'
                        : 'text-slate-700 hover:bg-slate-100'
                    )}
                    onClick={() => choose('hour12', h)}
                  >
                    {h}
                  </Button>
                ))}
              </div>
            </div>

            <span className="text-base font-bold text-slate-300 pb-2">:</span>

            {/* Minutes Column */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Minute</span>
              <div className="h-36 overflow-y-auto w-full flex flex-col gap-1 items-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {minutes.map((m) => (
                  <Button
                    key={m}
                    ref={m === minute ? minuteRef : null}
                    type="button"
                    size="sm"
                    variant={m === minute ? 'default' : 'ghost'}
                    className={cn(
                      'h-8 w-10 text-xs p-0 font-medium rounded-md transition-all shrink-0',
                      m === minute
                        ? 'bg-brand text-white font-semibold shadow-sm hover:bg-brand'
                        : 'text-slate-700 hover:bg-slate-100'
                    )}
                    onClick={() => choose('minute', m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            {/* AM / PM Column */}
            <div className="flex flex-col items-center gap-1.5 border-l border-slate-100 pl-2">
              <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Period</span>
              <div className="flex flex-col gap-1.5">
                {['AM', 'PM'].map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={p === period ? 'default' : 'outline'}
                    className={cn(
                      'h-8 w-11 text-xs font-bold p-0 rounded-md transition-all',
                      p === period
                        ? 'bg-brand text-white border-transparent shadow-sm hover:bg-brand'
                        : 'text-slate-600 border-slate-200 hover:bg-slate-100'
                    )}
                    onClick={() => choose('period', p)}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-0.5">
            <Button size="sm" className="bg-brand text-white text-xs h-7 px-3.5 rounded-md hover:bg-brand/90 font-medium shadow-sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
