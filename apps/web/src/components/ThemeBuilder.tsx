import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Save, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  FONT_OPTIONS,
  THEME_VARIABLES,
  downloadThemeFile,
  isValidHex,
  serializeTheme,
  slugify,
  validateDraft,
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
  const stored = useMemo(() => readStoredDraft(draftKey), [draftKey]);
  const [draft, setDraft] = useState<ThemeDraft>(stored ?? initialDraft);
  const [advanced, setAdvanced] = useState(false);
  const [idLocked, setIdLocked] = useState(editing || Boolean(stored?.id));
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
    setDraft((current) => ({
      ...current,
      colors: { ...current.colors, [variable]: value },
    }));

  const setName = (name: string) => {
    setDraft((current) => ({
      ...current,
      name,
      id: idLocked ? current.id : slugify(name),
    }));
  };

  const changeMode = (mode: ThemeDraft['mode']) => {
    setDraft((current) => ({ ...current, mode }));
  };

  const discardDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Ignore.
    }
    setDraft(initialDraft);
    setIdLocked(editing);
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
                <span className="text-xs font-medium uppercase tracking-wide text-faint">Mode</span>
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
                  A custom theme is either dark or light, never both.
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
                    Display font
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
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                      Swatches (comma separated)
                    </span>
                    <input
                      className="input font-mono text-xs"
                      value={draft.swatches.join(', ')}
                      onChange={(event) =>
                        set(
                          'swatches',
                          event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                      Lane colors (comma separated)
                    </span>
                    <input
                      className="input font-mono text-xs"
                      value={draft.laneColors.join(', ')}
                      onChange={(event) =>
                        set(
                          'laneColors',
                          event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                  </label>
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
