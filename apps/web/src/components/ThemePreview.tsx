import type { CSSProperties } from 'react';
import { GitBranch } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ThemeDraft } from '../lib/theme-draft';
import { shadowCss } from '../lib/theme-draft';

function cssVariables(draft: ThemeDraft): CSSProperties {
  const style: Record<string, string> = {
    '--canvas': draft.colors.canvas,
    '--panel': draft.colors.panel,
    '--raised': draft.colors.raised,
    '--edge': draft.colors.edge,
    '--ink': draft.colors.ink,
    '--muted': draft.colors.muted,
    '--faint': draft.colors.faint,
    '--accent': draft.colors.accent,
    '--accent-2': draft.colors['accent-2'],
    '--accent-3': draft.colors['accent-3'],
    '--success': draft.colors.success,
    '--warning': draft.colors.warning,
    '--danger': draft.colors.danger,
  };
  if (draft.fontDisplay?.trim()) style['--font-display'] = draft.fontDisplay.trim();
  if (draft.shadowPanel) style['--shadow-panel'] = shadowCss(draft.shadowPanel);
  if (draft.shadowCard) style['--shadow-card'] = shadowCss(draft.shadowCard, true);
  style.boxShadow = 'var(--shadow-card)';
  return style as CSSProperties;
}

export function ThemePreview({
  draft,
  className,
  compact = false,
}: {
  draft: ThemeDraft;
  className?: string;
  compact?: boolean;
}) {
  const laneColors = draft.laneColors.filter(Boolean).slice(0, 6);
  const swatches = draft.swatches.filter(Boolean).slice(0, 6);
  const displayFont = draft.fontDisplay?.trim() || undefined;
  const bodyFont = draft.fontBody?.trim() || undefined;

  return (
    <div
      data-theme={draft.mode}
      style={{ ...cssVariables(draft), fontFamily: bodyFont }}
      className={cn(
        'overflow-hidden rounded-xl border border-edge bg-canvas p-4 text-ink',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised/70 text-accent">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p
            className="truncate text-base font-semibold leading-tight"
            style={{ fontFamily: displayFont }}
          >
            {draft.name.trim() || 'Untitled theme'}
          </p>
          <p className="truncate text-[10px] text-muted">
            {draft.tagline.trim() || 'Live preview'} ·{' '}
            <span className="capitalize">{draft.mode}</span>
          </p>
        </div>
        {draft.badge.trim() ? (
          <span className="badge badge-accent ml-auto shrink-0">{draft.badge.trim()}</span>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-edge bg-panel/95 p-3" style={{ boxShadow: 'var(--shadow-panel)' }}>
        <div className="flex items-center justify-between gap-2">
          <p
            className="truncate text-xs font-medium text-ink"
            style={{ fontFamily: displayFont }}
          >
            feat: wake the old castle
          </p>
          <span className="badge badge-accent shrink-0">HEAD</span>
        </div>
        <p className="mt-0.5 text-[10px] text-muted">Ada Lovelace · main · 2m ago</p>
        <div className="mt-2 flex items-center gap-1.5" aria-hidden>
          {laneColors.map((color, index) => (
            <span
              key={`${color}-${index}`}
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

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wide text-faint">Palette</span>
        <div className="flex gap-1.5">
          {swatches.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className="h-3 w-6 rounded-sm ring-1 ring-black/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {!compact && draft.description.trim() ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{draft.description.trim()}</p>
      ) : null}
    </div>
  );
}
