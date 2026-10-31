import { useMemo, useState } from 'react';
import type { UiStyle } from '@gitastic/shared';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { filterStylesByMode, uiStyleMeta, useStyleLibrary, type StyleMode } from '../ui-styles';

export function StylePicker({
  current,
  currentMode,
  onSelect,
}: {
  current: UiStyle;
  currentMode: StyleMode;
  onSelect: (style: UiStyle, mode: StyleMode) => void;
}) {
  const [preview, setPreview] = useState<{ id: string; mode: StyleMode } | null>(null);
  const library = useStyleLibrary();
  const previewMeta = uiStyleMeta(preview?.id ?? current);
  const previewMode = preview?.mode ?? currentMode;
  const PreviewIcon = previewMeta.icon;
  const groups = useMemo(
    () =>
      [
        { key: 'dark', label: 'Dark styles', mode: 'dark' as const, styles: filterStylesByMode(library, 'dark') },
        { key: 'light', label: 'Light styles', mode: 'light' as const, styles: filterStylesByMode(library, 'light') },
      ].filter((group) => group.styles.length > 0),
    [library],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
            Style library
          </span>
          <span className="text-[10px] text-faint">Grouped by mode</span>
        </div>
        <div
          role="radiogroup"
          aria-label="UI style"
          className="scrollbar-thin flex max-h-[42rem] flex-col gap-3 overflow-y-auto pr-1"
        >
          {groups.map((group) => (
            <div key={group.key}>
              <div className="sticky top-0 z-10 mb-1 flex items-center justify-between bg-panel/95 px-1 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {group.label}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-faint">
                  {group.styles.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {group.styles.map((meta) => {
                  const Icon = meta.icon;
                  const active = meta.id === current && group.mode === currentMode;
                  const previewed =
                    meta.id === preview?.id && group.mode === preview?.mode;

                  return (
                    <button
                      key={`${group.key}-${meta.id}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onSelect(meta.id, group.mode)}
                      onMouseEnter={() => setPreview({ id: meta.id, mode: group.mode })}
                      onMouseLeave={() => setPreview(null)}
                      onFocus={() => setPreview({ id: meta.id, mode: group.mode })}
                      onBlur={() => setPreview(null)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
                        active
                          ? 'border-accent/70 bg-accent/10'
                          : previewed
                            ? 'border-edge bg-raised/60'
                            : 'border-transparent hover:border-edge hover:bg-raised/40',
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge bg-raised/70">
                        <Icon className="h-4 w-4 text-accent" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {meta.name}
                          </span>
                          {meta.badge ? (
                            <span
                              className={cn(
                                'badge shrink-0 px-1.5 py-0 text-[9px] uppercase tracking-wide',
                                active ? 'badge-accent' : '',
                              )}
                            >
                              {meta.badge}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] text-muted">
                          {meta.tagline}
                        </span>
                      </span>
                      <span className="hidden shrink-0 gap-1 sm:flex" aria-hidden>
                        {meta.swatches.map((color) => (
                          <span
                            key={color}
                            className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="w-4 shrink-0">
                        {active ? <Check className="h-4 w-4 text-accent" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        data-style={previewMeta.id}
        data-theme={previewMode}
        aria-live="polite"
        aria-label={`Preview: ${previewMeta.name} (${previewMode})`}
        className="style-preview relative self-start overflow-hidden rounded-xl border border-edge p-4 lg:sticky lg:top-0"
        style={{
          background:
            'radial-gradient(120% 90% at 10% 0%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 62%), radial-gradient(110% 80% at 92% 100%, color-mix(in srgb, var(--accent-3) 14%, transparent), transparent 64%), var(--canvas)',
        }}
      >
        <div className="relative flex items-center gap-2.5">
          <div className="brand-mark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border">
            <PreviewIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="brand-title truncate text-base font-semibold leading-tight">
              {previewMeta.name}
            </p>
            <p className="truncate text-[10px] text-muted">
              {previewMeta.tagline} · <span className="capitalize">{previewMode}</span>
            </p>
          </div>
          {previewMeta.badge ? (
            <span className="badge badge-accent ml-auto shrink-0">{previewMeta.badge}</span>
          ) : null}
        </div>

        <div className="relative mt-3 rounded-lg border border-edge bg-panel/95 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-ink">feat: wake the old castle</p>
            <span className="badge badge-accent shrink-0">HEAD</span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted">Ada Lovelace · main · 2m ago</p>
          <div className="mt-2 flex items-center gap-1.5" aria-hidden>
            {previewMeta.laneColors.slice(0, 6).map((color) => (
              <span
                key={color}
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
            <span className="ml-1 text-[9px] uppercase tracking-wide text-faint">Graph</span>
          </div>
          <div className="mt-3 flex gap-2">
            <span className="btn btn-primary h-6 px-2 text-[10px]">Commit</span>
            <span className="btn h-6 px-2 text-[10px]">Diff</span>
          </div>
        </div>

        <div className="relative mt-3 flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wide text-faint">Palette</span>
          <div className="flex gap-1.5">
            {previewMeta.swatches.map((color) => (
              <span
                key={color}
                className="h-3 w-6 rounded-sm ring-1 ring-black/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
        <p className="relative mt-2 text-[11px] leading-relaxed text-muted">
          {previewMeta.description}
        </p>
      </div>
    </div>
  );
}
