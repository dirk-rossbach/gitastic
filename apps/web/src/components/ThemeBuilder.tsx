import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Save, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  FONT_OPTIONS,
  THEME_VARIABLES,
  downloadThemeFile,
  derivedSwatches,
  detectMode,
  isValidHex,
  normalizeDraft,
  serializeTheme,
  shadowCss,
  slugify,
  validateDraft,
  type ShadowConfig,
  type ThemeDraft,
  type ThemeVariable,
} from '../lib/theme-draft';
import { ThemePreview } from './ThemePreview';

const DRAFT_KEY = 'gitastic:theme-builder-draft';

const SIMPLE_VARIABLES: ThemeVariable[] = ['canvas', 'panel', 'ink', 'accent'];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = isValidHex(value);
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-edge bg-raised"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn('input h-8 font-mono text-xs', !valid && 'border-danger')}
        />
      </span>
    </label>
  );
}

function ListInput({
  label,
  values,
  onChange,
  max,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  placeholder: string;
  hint?: string;
}) {
  const [entry, setEntry] = useState('');

  const add = () => {
    const value = entry.trim().replace(/,$/, '').toUpperCase();
    if (!value || !isValidHex(value) || values.length >= max) return;
    onChange([...values, value]);
    setEntry('');
  };

  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-faint">
        <span>{label}</span>
        <span className="font-normal normal-case tracking-normal">
          {values.length} / {max}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="flex items-center gap-1.5 rounded border border-edge bg-raised px-2 py-0.5 font-mono text-[11px]"
          >
            <span
              className="h-3 w-3 rounded-sm ring-1 ring-black/10"
              style={{ backgroundColor: value }}
            />
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="text-faint transition hover:text-danger"
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input h-8 flex-1 font-mono text-xs"
          value={entry}
          placeholder={placeholder}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="btn h-8 text-xs"
          disabled={!entry.trim() || values.length >= max}
          onClick={add}
        >
          Add
        </button>
      </div>
      <p className="text-[10px] text-faint">{hint ?? `Enter a hex color and press Enter. Up to ${max} values.`}</p>
    </div>
  );
}

function ShadowSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-faint">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal">{value}px</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

function ShadowEditor({
  label,
  value,
  insetHighlight,
  onChange,
}: {
  label: string;
  value: ShadowConfig;
  insetHighlight: boolean;
  onChange: (value: ShadowConfig) => void;
}) {
  const css = shadowCss(value, insetHighlight);
  const set = <K extends keyof ShadowConfig>(key: K, next: ShadowConfig[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="space-y-3 rounded-lg border border-edge bg-raised/30 p-3 sm:col-span-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={value.enabled}
              onChange={(event) => set('enabled', event.target.checked)}
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={value.inset}
              onChange={(event) => set('inset', event.target.checked)}
            />
            Inset
          </label>
        </div>
      </div>

      <div className={cn('space-y-3', !value.enabled && 'pointer-events-none opacity-40')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ShadowSlider label="Offset X" value={value.x} min={-60} max={60} onChange={(next) => set('x', next)} />
          <ShadowSlider label="Offset Y" value={value.y} min={-60} max={60} onChange={(next) => set('y', next)} />
          <ShadowSlider label="Blur" value={value.blur} min={0} max={160} onChange={(next) => set('blur', next)} />
          <ShadowSlider label="Spread" value={value.spread} min={-40} max={40} onChange={(next) => set('spread', next)} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] text-muted">
            Color
            <input
              type="color"
              value={isValidHex(value.color) ? value.color : '#000000'}
              onChange={(event) => set('color', event.target.value.toUpperCase())}
              className="h-7 w-9 cursor-pointer rounded border border-edge bg-raised"
            />
            <span className="font-mono text-[10px] text-faint">{value.color}</span>
          </label>
          <label className="flex min-w-48 flex-1 items-center gap-2 text-[11px] text-muted">
            Opacity
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(value.opacity * 100)}
              onChange={(event) => set('opacity', Number(event.target.value) / 100)}
              className="flex-1 accent-accent"
            />
            <span className="w-10 text-right font-mono">{Math.round(value.opacity * 100)}%</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="h-12 w-24 shrink-0 rounded-md border border-edge bg-panel"
            style={{ boxShadow: css }}
          />
          <span className="break-all font-mono text-[10px] text-faint">{css}</span>
        </div>
      </div>
    </div>
  );
}

function readStoredDraft(key: string): ThemeDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ThemeDraft) : null;
  } catch {
    return null;
  }
}

export function ThemeBuilder({
  initialDraft,
  takenIds,
  editing,
  busy,
  onBack,
  onSave,
}: {
  initialDraft: ThemeDraft;
  takenIds: string[];
  editing: boolean;
  busy: boolean;
  onBack: () => void;
  onSave: (draft: ThemeDraft) => Promise<void> | void;
}) {
  const draftKey = editing ? `${DRAFT_KEY}:${initialDraft.id}` : `${DRAFT_KEY}:new`;
  const stored = useMemo(() => {
    const raw = readStoredDraft(draftKey);
    return raw ? normalizeDraft(raw) : null;
  }, [draftKey]);
  const [draft, setDraft] = useState<ThemeDraft>(() => stored ?? normalizeDraft(initialDraft));
  const [advanced, setAdvanced] = useState(false);
  const [idLocked, setIdLocked] = useState(editing || Boolean(stored?.id));
  const [modeTouched, setModeTouched] = useState(editing || Boolean(stored));
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Ignore storage failures.
    }
  }, [draft, draftKey]);

  const errors = validateDraft(draft, takenIds.filter((id) => id !== initialDraft.id));
  const invalid = errors.length > 0;

  const set = <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setColor = (variable: ThemeVariable, value: string) =>
    setDraft((current) => {
      const colors = { ...current.colors, [variable]: value };
      return {
        ...current,
        colors,
        mode: modeTouched ? current.mode : detectMode(colors),
      };
    });

  const setName = (name: string) => {
    setDraft((current) => ({
      ...current,
      name,
      id: idLocked ? current.id : slugify(name),
    }));
  };

  const changeMode = (mode: ThemeDraft['mode']) => {
    setModeTouched(true);
    setDraft((current) => ({ ...current, mode }));
  };

  const useDetectedMode = () => {
    setModeTouched(false);
    setDraft((current) => ({ ...current, mode: detectMode(current.colors) }));
  };

  const discardDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Ignore.
    }
    setDraft(normalizeDraft(initialDraft));
    setIdLocked(editing);
    setModeTouched(editing);
    setShowErrors(false);
  };

  const submit = async () => {
    if (invalid) {
      setShowErrors(true);
      return;
    }
    await onSave(draft);
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Ignore.
    }
  };

  const simpleVariables = THEME_VARIABLES.filter((variable) =>
    SIMPLE_VARIABLES.includes(variable.key),
  );
  const advancedVariables = THEME_VARIABLES.filter(
    (variable) => !SIMPLE_VARIABLES.includes(variable.key),
  );

  return (
    <div className="app-backdrop scrollbar-thin h-full overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" className="btn h-8 text-xs" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div>
              <h1 className="gradient-text text-xl font-semibold">Theme Builder</h1>
              <p className="text-xs text-muted">
                {editing ? `Editing ${initialDraft.name}` : 'Create a new custom theme'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn h-8 text-xs"
              onClick={() => downloadThemeFile(draft)}
              disabled={invalid}
            >
              <Download className="h-3.5 w-3.5" />
              Export .css
            </button>
            <button type="button" className="btn h-8 text-xs" onClick={discardDraft}>
              <Trash2 className="h-3.5 w-3.5 text-danger" />
              Discard draft
            </button>
            <button
              type="button"
              className="btn btn-primary h-8 text-xs"
              onClick={() => void submit()}
              disabled={busy}
            >
              <Save className="h-3.5 w-3.5" />
              {editing ? 'Save changes' : 'Save theme'}
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          <div className="space-y-5">
            <section className="card space-y-4 p-5">
              <h2 className="panel-title">Details</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">Name</span>
                  <input
                    className="input text-sm"
                    value={draft.name}
                    placeholder="My theme"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">Id</span>
                  <input
                    className="input font-mono text-sm"
                    value={draft.id}
                    readOnly={idLocked}
                    placeholder="my-theme"
                    onChange={(event) => set('id', slugify(event.target.value))}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Mode
                  </span>
                  {modeTouched ? (
                    <button
                      type="button"
                      className="text-[11px] text-faint transition hover:text-ink"
                      onClick={useDetectedMode}
                    >
                      Detect from colors
                    </button>
                  ) : (
                    <span className="text-[11px] text-accent">Auto-detected</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {(['dark', 'light'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={cn(
                        'btn h-8 flex-1 text-xs capitalize',
                        draft.mode === mode && 'border-accent/70 bg-accent/10 text-accent',
                      )}
                      onClick={() => changeMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-faint">
                  {modeTouched
                    ? 'Manually set. Use “Detect from colors” to follow the background again.'
                    : 'Automatically detected from the canvas and panel brightness.'}
                </p>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-faint">Tagline</span>
                <input
                  className="input text-sm"
                  value={draft.tagline}
                  placeholder="Short description"
                  onChange={(event) => set('tagline', event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-faint">
                  Description
                </span>
                <textarea
                  className="input min-h-20 text-sm"
                  value={draft.description}
                  onChange={(event) => set('description', event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">Badge</span>
                  <input
                    className="input text-sm"
                    value={draft.badge}
                    onChange={(event) => set('badge', event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Creator
                  </span>
                  <input
                    className="input text-sm"
                    value={draft.author}
                    placeholder="Your name or handle"
                    onChange={(event) => set('author', event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Headline font
                  </span>
                  <select
                    className="select w-full text-sm"
                    value={draft.fontDisplay}
                    onChange={(event) => set('fontDisplay', event.target.value)}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.label} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Copy font
                  </span>
                  <select
                    className="select w-full text-sm"
                    value={draft.fontBody}
                    onChange={(event) => set('fontBody', event.target.value)}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.label} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="panel-title">Colors</h2>
                <button
                  type="button"
                  className="text-[11px] uppercase tracking-wide text-faint transition hover:text-ink"
                  onClick={() => setAdvanced((value) => !value)}
                >
                  {advanced ? 'Hide advanced' : 'Advanced'}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {simpleVariables.map((variable) => (
                  <ColorField
                    key={variable.key}
                    label={variable.label}
                    value={draft.colors[variable.key]}
                    onChange={(value) => setColor(variable.key, value)}
                  />
                ))}
              </div>
              {advanced ? (
                <div className="grid gap-3 border-t border-edge pt-4 sm:grid-cols-2">
                  {advancedVariables.map((variable) => (
                    <ColorField
                      key={variable.key}
                      label={variable.label}
                      value={draft.colors[variable.key]}
                      onChange={(value) => setColor(variable.key, value)}
                    />
                  ))}
                  <div className="space-y-1.5 sm:col-span-2">
                    <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-faint">
                      <span>Swatches</span>
                      <span className="font-normal normal-case tracking-normal">derived</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {derivedSwatches(draft.colors).map((color) => (
                        <span
                          key={color}
                          className="flex items-center gap-1.5 rounded border border-edge bg-raised px-2 py-0.5 font-mono text-[11px]"
                        >
                          <span
                            className="h-3 w-3 rounded-sm ring-1 ring-black/10"
                            style={{ backgroundColor: color }}
                          />
                          {color}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-faint">
                      Automatically taken from Accent, Accent 2 and Accent 3.
                    </p>
                  </div>
                  <ListInput
                    label="Lane colors"
                    values={draft.laneColors}
                    max={16}
                    placeholder="#a78bfa"
                    onChange={(values) => set('laneColors', values)}
                  />
                  <ShadowEditor
                    label="Card shadow"
                    value={draft.shadowCard}
                    insetHighlight
                    onChange={(value) => set('shadowCard', value)}
                  />
                  <ShadowEditor
                    label="Panel shadow"
                    value={draft.shadowPanel}
                    insetHighlight={false}
                    onChange={(value) => set('shadowPanel', value)}
                  />
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                      Keywords
                    </span>
                    <input
                      className="input text-xs"
                      value={draft.keywords}
                      onChange={(event) => set('keywords', event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </section>

            {showErrors && invalid ? (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-faint">
              <Sparkles className="h-3.5 w-3.5" />
              Live preview
            </div>
            <ThemePreview draft={draft} />
            <details className="card p-4">
              <summary className="cursor-pointer text-xs font-medium text-muted">
                CSS preview
              </summary>
              <pre className="scrollbar-thin mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-faint">
                {serializeTheme(draft)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
