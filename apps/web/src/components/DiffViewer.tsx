import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Columns2,
  Copy,
  FileDiff,
  Minus,
  Plus,
  Rows3,
  Undo2,
} from 'lucide-react';
import type { DiffFile, FileKind } from '@gitastic/shared';
import { cn } from '../lib/utils';
import { PathText } from './ui';

export interface DiffReveal {
  path: string;
  nonce: number;
}

export type DiffStageMode = 'unstaged' | 'staged' | null;

interface DiffLineItem {
  kind: 'add' | 'del' | 'context';
  rawText: string;
  code: string;
  oldLine: number | null;
  newLine: number | null;
  highlighted?: ReactNode;
}

interface SplitRow {
  left: DiffLineItem | null;
  leftIndex: number | null;
  right: DiffLineItem | null;
  rightIndex: number | null;
}

interface ParsedHunk {
  rawHeader: string;
  label: string;
  oldStart: number;
  newStart: number;
  lines: DiffLineItem[];
  splitRows?: SplitRow[];
}

interface ParsedDiffFile {
  key: string;
  path: string;
  oldPath: string | null;
  status: FileKind | null;
  headerLines: string[];
  hunks: ParsedHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
  totalLines: number;
}

const MAX_AUTO_EXPANDED_FILES = 8;
const INITIAL_MOUNTED_FILES = 24;
const MOUNT_BATCH_SIZE = 24;
const MAX_INITIAL_LINES_PER_FILE = 300;
const MAX_HIGHLIGHT_LINE_LENGTH = 200;

const KEYWORD_SET = new Set([
  'import',
  'export',
  'from',
  'const',
  'let',
  'var',
  'function',
  'return',
  'async',
  'await',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'class',
  'interface',
  'type',
  'extends',
  'implements',
  'true',
  'false',
  'null',
  'undefined',
  'fn',
  'pub',
  'struct',
  'enum',
  'impl',
  'match',
  'use',
  'mod',
  'mut',
  'def',
  'try',
  'catch',
  'throw',
]);

function highlightCode(code: string): ReactNode {
  if (!code) return ' ';
  if (code.length > MAX_HIGHLIGHT_LINE_LENGTH) return code;
  const trimmed = code.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('# ')) {
    return <span className="italic opacity-60">{code}</span>;
  }

  const tokens = code.split(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g,
  );
  if (tokens.length <= 1) return code;

  return tokens.map((token, idx) => {
    if (!token) return null;
    const first = token[0];
    if (first === '"' || first === "'" || first === '`') {
      return (
        <span key={idx} className="text-warning/90">
          {token}
        </span>
      );
    }
    if (KEYWORD_SET.has(token)) {
      return (
        <span key={idx} className="font-semibold text-accent">
          {token}
        </span>
      );
    }
    if (first !== undefined && first >= '0' && first <= '9') {
      return (
        <span key={idx} className="text-accent-2">
          {token}
        </span>
      );
    }
    return token;
  });
}

function renderLineCode(line: DiffLineItem, allowHighlight: boolean): ReactNode {
  if (!allowHighlight) return line.code || ' ';
  if (line.highlighted === undefined) {
    line.highlighted = highlightCode(line.code);
  }
  return line.highlighted;
}

function isMetadataNoiseLine(line: string): boolean {
  return (
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('dissimilarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('\\ No newline at end of file')
  );
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number; label: string } {
  const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
  if (!match) return { oldStart: 1, newStart: 1, label: line };
  const oldStart = Number(match[1]) || 1;
  const newStart = Number(match[2]) || 1;
  const context = (match[3] ?? '').trim();
  return {
    oldStart,
    newStart,
    label: context ? `Line ${newStart} · ${context}` : `Line ${newStart}`,
  };
}

function parseDiffFiles(patch: string, files?: DiffFile[]): ParsedDiffFile[] {
  const sections: ParsedDiffFile[] = [];
  const fileMetaByPath = new Map<string, DiffFile>();
  if (files) {
    for (const file of files) {
      fileMetaByPath.set(file.path, file);
      if (file.oldPath) fileMetaByPath.set(file.oldPath, file);
    }
  }

  let current: ParsedDiffFile | null = null;
  let currentHunk: ParsedHunk | null = null;
  let oldLine = 1;
  let newLine = 1;

  const startSection = (path: string, oldPath: string | null, index: number, rawDiffLine?: string) => {
    const meta = fileMetaByPath.get(path) ?? (oldPath ? fileMetaByPath.get(oldPath) : undefined) ?? files?.[index];
    const resolvedPath = meta?.path ?? path;
    const resolvedOldPath = meta?.oldPath ?? oldPath;
    const key = resolvedPath || `file-${index}`;
    current = {
      key,
      path: resolvedPath,
      oldPath: resolvedOldPath,
      status: meta?.status ?? null,
      headerLines: rawDiffLine ? [rawDiffLine] : [`diff --git a/${resolvedPath} b/${resolvedPath}`],
      hunks: [],
      binary: meta?.binary ?? false,
      additions: meta?.additions ?? 0,
      deletions: meta?.deletions ?? 0,
      totalLines: 0,
    };
    currentHunk = null;
    sections.push(current);
  };

  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      const split = rest.lastIndexOf(' b/');
      const oldPath = split >= 0 && rest.startsWith('a/') ? rest.slice(2, split) : null;
      const path = split >= 0 ? rest.slice(split + 3) : (oldPath ?? `file-${sections.length + 1}`);
      startSection(path, oldPath, sections.length, line);
      continue;
    }

    if (!current) {
      if (!line.trim()) continue;
      startSection(`file-${sections.length + 1}`, null, sections.length);
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current!.binary = true;
      continue;
    }

    if (!currentHunk) {
      if (line.startsWith('new file mode ')) {
        current!.status = current!.status ?? 'added';
        current!.headerLines.push(line);
        continue;
      }
      if (line.startsWith('deleted file mode ')) {
        current!.status = current!.status ?? 'deleted';
        current!.headerLines.push(line);
        continue;
      }
      if (line.startsWith('rename from ')) {
        current!.status = current!.status ?? 'renamed';
        current!.oldPath = line.slice('rename from '.length).trim();
        current!.headerLines.push(line);
        continue;
      }
      if (line.startsWith('rename to ')) {
        current!.status = current!.status ?? 'renamed';
        current!.path = line.slice('rename to '.length).trim();
        current!.headerLines.push(line);
        continue;
      }
      if (isMetadataNoiseLine(line)) {
        if (!line.startsWith('\\ No newline')) {
          current!.headerLines.push(line);
        }
        continue;
      }
    }

    if (line.startsWith('@@')) {
      const parsed = parseHunkHeader(line);
      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      currentHunk = {
        rawHeader: line,
        label: parsed.label,
        oldStart: parsed.oldStart,
        newStart: parsed.newStart,
        lines: [],
      };
      current!.hunks.push(currentHunk);
      continue;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    if (!currentHunk) {
      if (isMetadataNoiseLine(line)) continue;
      currentHunk = {
        rawHeader: '@@ -1,1 +1,1 @@',
        label: 'Line 1',
        oldStart: 1,
        newStart: 1,
        lines: [],
      };
      oldLine = 1;
      newLine = 1;
      current!.hunks.push(currentHunk);
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        kind: 'add',
        rawText: line,
        code: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        kind: 'del',
        rawText: line,
        code: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    } else {
      currentHunk.lines.push({
        kind: 'context',
        rawText: line.startsWith(' ') ? line : ` ${line}`,
        code: line.startsWith(' ') ? line.slice(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  for (const section of sections) {
    if (!section.headerLines.some((l) => l.startsWith('--- '))) {
      section.headerLines.push(
        section.status === 'added' ? '--- /dev/null' : `--- a/${section.oldPath ?? section.path}`,
      );
    }
    if (!section.headerLines.some((l) => l.startsWith('+++ '))) {
      section.headerLines.push(
        section.status === 'deleted' ? '+++ /dev/null' : `+++ b/${section.path}`,
      );
    }
    let calcAdditions = 0;
    let calcDeletions = 0;
    let totalLines = 0;
    for (const hunk of section.hunks) {
      while (
        hunk.lines.length > 0 &&
        hunk.lines[hunk.lines.length - 1]?.kind === 'context' &&
        !hunk.lines[hunk.lines.length - 1]?.code.trim()
      ) {
        hunk.lines.pop();
      }
      totalLines += hunk.lines.length;
      for (const line of hunk.lines) {
        if (line.kind === 'add') calcAdditions += 1;
        else if (line.kind === 'del') calcDeletions += 1;
      }
    }
    section.totalLines = totalLines;
    if (section.additions === 0 && section.deletions === 0) {
      section.additions = calcAdditions;
      section.deletions = calcDeletions;
    }
  }

  return sections;
}

function buildHunkPatch(section: ParsedDiffFile, hunk: ParsedHunk): string {
  return `${[
    ...section.headerLines,
    hunk.rawHeader,
    ...hunk.lines.map((l) => l.rawText),
  ].join('\n')}\n`;
}

function buildSingleLinePatch(
  section: ParsedDiffFile,
  hunk: ParsedHunk,
  lineIndex: number,
  reverse: boolean,
): string {
  const bodyLines: string[] = [];
  hunk.lines.forEach((line, idx) => {
    if (idx === lineIndex) {
      bodyLines.push(line.rawText);
    } else if (line.kind === 'context') {
      bodyLines.push(line.rawText);
    } else if (!reverse) {
      if (line.kind === 'del') {
        bodyLines.push(` ${line.code}`);
      }
    } else {
      if (line.kind === 'add') {
        bodyLines.push(` ${line.code}`);
      }
    }
  });
  return `${[...section.headerLines, hunk.rawHeader, ...bodyLines].join('\n')}\n`;
}

function getSplitRows(hunk: ParsedHunk): SplitRow[] {
  if (hunk.splitRows) return hunk.splitRows;
  const lines = hunk.lines;
  const rows: SplitRow[] = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.kind === 'context') {
      rows.push({ left: line, leftIndex: idx, right: line, rightIndex: idx });
      idx += 1;
      continue;
    }
    const dels: Array<{ item: DiffLineItem; index: number }> = [];
    const adds: Array<{ item: DiffLineItem; index: number }> = [];
    while (idx < lines.length && lines[idx]!.kind === 'del') {
      dels.push({ item: lines[idx]!, index: idx });
      idx += 1;
    }
    while (idx < lines.length && lines[idx]!.kind === 'add') {
      adds.push({ item: lines[idx]!, index: idx });
      idx += 1;
    }
    const count = Math.max(dels.length, adds.length);
    for (let i = 0; i < count; i += 1) {
      rows.push({
        left: dels[i]?.item ?? null,
        leftIndex: dels[i]?.index ?? null,
        right: adds[i]?.item ?? null,
        rightIndex: adds[i]?.index ?? null,
      });
    }
  }
  hunk.splitRows = rows;
  return rows;
}

function statusBadge(status: FileKind | null) {
  if (!status || status === 'modified' || status === 'unknown') return null;
  if (status === 'added' || status === 'untracked') {
    return <span className="badge badge-success">new</span>;
  }
  if (status === 'deleted') {
    return <span className="badge badge-danger">deleted</span>;
  }
  if (status === 'renamed') {
    return <span className="badge badge-accent">renamed</span>;
  }
  if (status === 'copied') {
    return <span className="badge badge-accent">copied</span>;
  }
  return null;
}

export function DiffViewer({
  patch,
  binary,
  tooLarge,
  emptyLabel = 'No changes to show.',
  files,
  reveal,
  stageMode = null,
  onApplyPatch,
}: {
  patch: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyLabel?: string;
  files?: DiffFile[];
  reveal?: DiffReveal | null;
  stageMode?: DiffStageMode;
  onApplyPatch?: (options: { patch: string; cached?: boolean; reverse?: boolean; label: string }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const sections = useMemo(() => parseDiffFiles(patch, files), [patch, files]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    sections.length > MAX_AUTO_EXPANDED_FILES
      ? new Set(sections.slice(MAX_AUTO_EXPANDED_FILES).map((s) => s.key))
      : new Set(),
  );
  const [expandedLongFiles, setExpandedLongFiles] = useState<Set<string>>(new Set());
  const [mountedCount, setMountedCount] = useState(INITIAL_MOUNTED_FILES);
  const [highlight, setHighlight] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(
      sections.length > MAX_AUTO_EXPANDED_FILES
        ? new Set(sections.slice(MAX_AUTO_EXPANDED_FILES).map((s) => s.key))
        : new Set(),
    );
    setExpandedLongFiles(new Set());
    setMountedCount(INITIAL_MOUNTED_FILES);
  }, [sections]);

  useEffect(() => {
    if (!reveal) return;
    const targetIndex = sections.findIndex(
      (section) => section.path === reveal.path || section.oldPath === reveal.path,
    );
    if (targetIndex < 0) return;
    const target = sections[targetIndex]!;

    if (targetIndex >= mountedCount) {
      setMountedCount(Math.min(sections.length, targetIndex + MOUNT_BATCH_SIZE));
    }

    setCollapsed((previous) => {
      if (!previous.has(target.key)) return previous;
      const next = new Set(previous);
      next.delete(target.key);
      return next;
    });
    setHighlight(target.key);

    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const node = [...container.querySelectorAll<HTMLElement>('[data-diff-file]')].find(
        (element) => element.dataset.diffFile === target.key,
      );
      if (!node) return;
      const top =
        node.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        8;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => setHighlight(null), 1600);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [reveal, sections, mountedCount]);

  if (!patch.trim()) {
    if (binary) {
      return (
        <div className="diff-empty-state">
          <FileDiff className="h-8 w-8 text-accent" />
          <p>Binary file.</p>
        </div>
      );
    }
    return (
      <div className="diff-empty-state">
        <FileDiff className="h-8 w-8 text-faint" />
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const toggle = (key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canPartialStage = Boolean(stageMode && onApplyPatch);
  const visibleSections =
    sections.length > mountedCount ? sections.slice(0, mountedCount) : sections;
  const allowSyntaxHighlight = sections.length <= 40;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="diff-toolbar">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="diff-count-pill">
            {sections.length || 1} {sections.length === 1 ? 'file' : 'files'}
          </span>
          {tooLarge ? <span className="badge badge-danger">truncated</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-edge bg-panel/80 p-0.5 text-xs">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition',
                viewMode === 'unified' ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
              )}
              onClick={() => startTransition(() => setViewMode('unified'))}
              title="Unified diff"
            >
              <Rows3 className="h-3 w-3" />
              Unified
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition',
                viewMode === 'split' ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
              )}
              onClick={() => startTransition(() => setViewMode('split'))}
              title="Side-by-side split diff"
            >
              <Columns2 className="h-3 w-3" />
              Split
            </button>
          </div>
          {sections.length > 1 ? (
            <button
              type="button"
              className="btn btn-ghost h-7 text-xs"
              onClick={() =>
                startTransition(() => {
                  setCollapsed((previous) =>
                    previous.size >= sections.length
                      ? new Set()
                      : new Set(sections.map((section) => section.key)),
                  );
                })
              }
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {collapsed.size >= sections.length ? 'Expand all' : 'Collapse all'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost h-7 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(patch).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy patch'}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-canvas/70 p-2.5"
        onScroll={(event) => {
          if (mountedCount >= sections.length) return;
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 480) {
            setMountedCount((prev) => Math.min(sections.length, prev + MOUNT_BATCH_SIZE));
          }
        }}
      >
        <div className="space-y-2.5">
          {visibleSections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.key);
            const displayLabel =
              section.oldPath && section.oldPath !== section.path
                ? `${section.oldPath} → ${section.path}`
                : section.path || 'Patch';
            const isLongFile = section.totalLines > MAX_INITIAL_LINES_PER_FILE;
            const showFullLongFile = !isLongFile || expandedLongFiles.has(section.key);
            let remainingLineBudget = showFullLongFile
              ? Number.POSITIVE_INFINITY
              : MAX_INITIAL_LINES_PER_FILE;

            return (
              <section
                key={`${section.key}-${sectionIndex}`}
                data-diff-file={section.key}
                className={cn(
                  'diff-file-card scroll-mt-2 overflow-hidden rounded-xl border border-edge/80 bg-panel/70',
                  highlight === section.key && 'diff-file-highlight',
                )}
              >
                <button
                  type="button"
                  className="diff-file-header"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(section.key)}
                >
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted transition-transform duration-150',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                  <FileDiff className="h-4 w-4 shrink-0 text-accent" />
                  <PathText
                    text={displayLabel}
                    className="min-w-0 flex-1 text-left font-mono text-xs text-ink"
                  />
                  {statusBadge(section.status)}
                  {section.binary ? <span className="badge">binary</span> : null}
                  {section.additions > 0 ? (
                    <span className="diff-additions">+{section.additions}</span>
                  ) : null}
                  {section.deletions > 0 ? (
                    <span className="diff-deletions">-{section.deletions}</span>
                  ) : null}
                </button>

                {!isCollapsed ? (
                  <div className="overflow-hidden">
                    {section.binary ? (
                      <div className="border-t border-edge/70 px-3 py-5 text-center text-xs text-muted">
                        Binary file.
                      </div>
                    ) : (
                      <div className="border-t border-edge/70">
                        {section.hunks.map((hunk, hunkIdx) => {
                          if (remainingLineBudget <= 0) return null;
                          const unifiedLines =
                            hunk.lines.length > remainingLineBudget
                              ? hunk.lines.slice(0, remainingLineBudget)
                              : hunk.lines;
                          const allSplitRows = viewMode === 'split' ? getSplitRows(hunk) : [];
                          const splitRows =
                            viewMode === 'split' && allSplitRows.length > remainingLineBudget
                              ? allSplitRows.slice(0, remainingLineBudget)
                              : allSplitRows;
                          remainingLineBudget -=
                            viewMode === 'split' ? splitRows.length : unifiedLines.length;

                          return (
                            <div key={`${hunkIdx}-${hunk.rawHeader}`}>
                              {(section.hunks.length > 1 || canPartialStage) ? (
                                <div className="diff-hunk flex items-center justify-between gap-2 px-3 py-1 font-mono text-[11px]">
                                  <span className="truncate">{hunk.label}</span>
                                  {canPartialStage && onApplyPatch ? (
                                    <div className="flex items-center gap-1">
                                      {stageMode === 'unstaged' ? (
                                        <>
                                          <button
                                            type="button"
                                            className="btn h-5 px-1.5 text-[10px]"
                                            onClick={() =>
                                              onApplyPatch({
                                                patch: buildHunkPatch(section, hunk),
                                                cached: true,
                                                reverse: false,
                                                label: 'Hunk staged.',
                                              })
                                            }
                                          >
                                            <Plus className="h-3 w-3 text-success" />
                                            Stage hunk
                                          </button>
                                          <button
                                            type="button"
                                            className="btn h-5 px-1.5 text-[10px] hover:text-danger"
                                            onClick={() =>
                                              onApplyPatch({
                                                patch: buildHunkPatch(section, hunk),
                                                cached: false,
                                                reverse: true,
                                                label: 'Hunk discarded.',
                                              })
                                            }
                                          >
                                            <Undo2 className="h-3 w-3 text-danger" />
                                            Discard hunk
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn h-5 px-1.5 text-[10px]"
                                          onClick={() =>
                                            onApplyPatch({
                                              patch: buildHunkPatch(section, hunk),
                                              cached: true,
                                              reverse: true,
                                              label: 'Hunk unstaged.',
                                            })
                                          }
                                        >
                                          <Minus className="h-3 w-3 text-warning" />
                                          Unstage hunk
                                        </button>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {viewMode === 'unified' ? (
                                unifiedLines.map((line, lineIdx) => {
                                  const className =
                                    line.kind === 'add'
                                      ? 'diff-add'
                                      : line.kind === 'del'
                                        ? 'diff-del'
                                        : 'text-muted';
                                  const isChanged = line.kind === 'add' || line.kind === 'del';
                                  return (
                                    <div
                                      key={lineIdx}
                                      className={cn(
                                        'group diff-line flex items-start gap-2',
                                        className,
                                      )}
                                    >
                                      <span className="w-8 shrink-0 select-none text-right text-[10px] text-faint/70">
                                        {line.oldLine ?? ''}
                                      </span>
                                      <span className="w-8 shrink-0 select-none text-right text-[10px] text-faint/70">
                                        {line.newLine ?? ''}
                                      </span>
                                      <span className="w-3 shrink-0 select-none text-center opacity-70">
                                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        {renderLineCode(line, allowSyntaxHighlight)}
                                      </span>
                                      {canPartialStage && isChanged && onApplyPatch ? (
                                        <span className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                          {stageMode === 'unstaged' ? (
                                            <>
                                              <button
                                                type="button"
                                                className="rounded border border-edge bg-panel/90 px-1.5 py-0 text-[10px] text-ink hover:border-accent"
                                                onClick={() =>
                                                  onApplyPatch({
                                                    patch: buildSingleLinePatch(
                                                      section,
                                                      hunk,
                                                      lineIdx,
                                                      false,
                                                    ),
                                                    cached: true,
                                                    reverse: false,
                                                    label: 'Line staged.',
                                                  })
                                                }
                                              >
                                                + Stage line
                                              </button>
                                              <button
                                                type="button"
                                                className="rounded border border-edge bg-panel/90 px-1.5 py-0 text-[10px] text-danger hover:border-danger"
                                                onClick={() =>
                                                  onApplyPatch({
                                                    patch: buildSingleLinePatch(
                                                      section,
                                                      hunk,
                                                      lineIdx,
                                                      true,
                                                    ),
                                                    cached: false,
                                                    reverse: true,
                                                    label: 'Line discarded.',
                                                  })
                                                }
                                              >
                                                Discard
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              type="button"
                                              className="rounded border border-edge bg-panel/90 px-1.5 py-0 text-[10px] text-ink hover:border-accent"
                                              onClick={() =>
                                                onApplyPatch({
                                                  patch: buildSingleLinePatch(
                                                    section,
                                                    hunk,
                                                    lineIdx,
                                                    true,
                                                  ),
                                                  cached: true,
                                                  reverse: true,
                                                  label: 'Line unstaged.',
                                                })
                                              }
                                            >
                                              - Unstage line
                                            </button>
                                          )}
                                        </span>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="divide-y divide-edge/30">
                                  {splitRows.map((row, rowIdx) => (
                                    <div
                                      key={rowIdx}
                                      className="grid grid-cols-2 divide-x divide-edge/50"
                                    >
                                      <div
                                        className={cn(
                                          'diff-line flex items-start gap-2',
                                          row.left?.kind === 'del'
                                            ? 'diff-del'
                                            : 'text-muted',
                                        )}
                                      >
                                        <span className="w-7 shrink-0 select-none text-right text-[10px] text-faint/70">
                                          {row.left?.oldLine ?? ''}
                                        </span>
                                        <span className="w-3 shrink-0 select-none text-center opacity-70">
                                          {row.left?.kind === 'del' ? '-' : ' '}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          {row.left
                                            ? renderLineCode(row.left, allowSyntaxHighlight)
                                            : ' '}
                                        </span>
                                      </div>
                                      <div
                                        className={cn(
                                          'diff-line flex items-start gap-2',
                                          row.right?.kind === 'add'
                                            ? 'diff-add'
                                            : 'text-muted',
                                        )}
                                      >
                                        <span className="w-7 shrink-0 select-none text-right text-[10px] text-faint/70">
                                          {row.right?.newLine ?? ''}
                                        </span>
                                        <span className="w-3 shrink-0 select-none text-center opacity-70">
                                          {row.right?.kind === 'add' ? '+' : ' '}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          {row.right
                                            ? renderLineCode(row.right, allowSyntaxHighlight)
                                            : ' '}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {!showFullLongFile ? (
                          <div className="border-t border-edge/60 bg-canvas/40 px-3 py-2 text-center">
                            <button
                              type="button"
                              className="btn h-6 text-xs"
                              onClick={() =>
                                setExpandedLongFiles((prev) => {
                                  const next = new Set(prev);
                                  next.add(section.key);
                                  return next;
                                })
                              }
                            >
                              Show all {section.totalLines} lines (+
                              {section.totalLines - MAX_INITIAL_LINES_PER_FILE} more)
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}

          {mountedCount < sections.length ? (
            <div className="py-2 text-center">
              <button
                type="button"
                className="btn h-7 text-xs"
                onClick={() =>
                  setMountedCount((prev) => Math.min(sections.length, prev + MOUNT_BATCH_SIZE * 2))
                }
              >
                Show more files ({sections.length - mountedCount} remaining)
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
