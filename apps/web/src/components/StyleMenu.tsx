import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiStyle } from '@gitastic/shared';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { filterStylesByMode, uiStyleMeta, useStyleLibrary, type StyleMode } from '../ui-styles';

export function StyleMenu({
  current,
  currentMode,
  onSelect,
}: {
  current: UiStyle;
  currentMode: StyleMode;
  onSelect: (style: UiStyle, mode: StyleMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const library = useStyleLibrary();
  const currentMeta = uiStyleMeta(current);
  const CurrentIcon = currentMeta.icon;
  const groups = useMemo(
    () =>
      [
        { key: 'dark', label: 'Dark styles', mode: 'dark' as const, styles: filterStylesByMode(library, 'dark') },
        { key: 'light', label: 'Light styles', mode: 'light' as const, styles: filterStylesByMode(library, 'light') },
      ].filter((group) => group.styles.length > 0),
    [library],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-edge bg-panel/80 px-2.5 py-1.5 text-xs transition hover:border-accent/40 hover:bg-raised/60"
      >
        <CurrentIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-medium text-ink">{currentMeta.name}</span>
        <span className="hidden gap-1 sm:flex" aria-hidden>
          {currentMeta.swatches.map((color) => (
            <span
              key={color}
              className="h-2 w-2 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="UI style"
          className="card absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden p-1.5 shadow-2xl"
        >
          <div className="scrollbar-thin max-h-[36rem] overflow-y-auto">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-faint">
                  {group.label}
                </p>
                {group.styles.map((meta) => {
                  const Icon = meta.icon;
                  const active = meta.id === current && group.mode === currentMode;

                  return (
                    <button
                      key={`${group.key}-${meta.id}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        onSelect(meta.id, group.mode);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition',
                        active ? 'bg-accent/10' : 'hover:bg-raised/70',
                      )}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge bg-raised/70">
                        <Icon className="h-3.5 w-3.5 text-accent" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {meta.name}
                        </span>
                        <span className="block truncate text-[10px] text-muted">
                          {meta.tagline}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1" aria-hidden>
                        {meta.swatches.map((color) => (
                          <span
                            key={color}
                            className="h-2 w-2 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="w-3.5 shrink-0">
                        {active ? <Check className="h-3.5 w-3.5 text-accent" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
