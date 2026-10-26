import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileWarning,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { ConflictBlock, ConflictFile } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, PathText, Spinner } from './ui';

type Choice = 'ours' | 'theirs' | 'both' | 'base';
type LineChoice = 'ours' | 'theirs';
type LineSelections = Record<string, LineChoice>;

type MergeCell = {
  text: string;
  line: number;
};

type MergeRow = {
  id: string;
  rowKey: string;
  rowIndex: number;
  kind: 'context' | Choice;
  selection: Choice;
  blockId: string | null;
  changed: boolean;
  ours: MergeCell | null;
  result: MergeCell | null;
  theirs: MergeCell | null;
};

const SEGMENT_META: Record<
  Choice,
  { label: string; border: string; background: string; text: string; dot: string }
> = {
  ours: {
    label: 'Ours',
    border: 'border-l-accent/70',
    background: 'bg-accent/10',
    text: 'text-accent',
    dot: 'bg-accent',
  },
  theirs: {
    label: 'Theirs',
    border: 'border-l-warning/70',
    background: 'bg-warning/10',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  both: {
    label: 'Both',
    border: 'border-l-success/70',
    background: 'bg-success/10',
    text: 'text-success',
    dot: 'bg-success',
  },
  base: {
    label: 'Base',
    border: 'border-l-edge',
    background: 'bg-raised/60',
    text: 'text-faint',
    dot: 'bg-faint',
  },
};

function splitBlockLines(text: string): string[] {
  return text.replace(/\n$/, '').split('\n');
}

const MAX_LCS_CELLS = 250_000;

function lcsAnchors(left: string[], right: string[]): Array<[number, number]> {
  if (left.length === 0 || right.length === 0) return [];
  if (left.length * right.length > MAX_LCS_CELLS) return [];

  const dp = Array.from({ length: left.length + 1 }, () =>
    new Uint32Array(right.length + 1),
  );

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      dp[i]![j] =
        left[i - 1] === right[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const anchors: Array<[number, number]> = [];
  let i = left.length;
  let j = right.length;
  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      anchors.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return anchors.reverse();
}

function alignBlockLines(
  left: string[],
  right: string[],
): Array<{ left: string | null; right: string | null }> {
  const anchors = lcsAnchors(left, right);
  const pairs: Array<{ left: string | null; right: string | null }> = [];
  let leftCursor = 0;
  let rightCursor = 0;

  const pushGap = (leftEnd: number, rightEnd: number) => {
    const leftRun = left.slice(leftCursor, leftEnd);
    const rightRun = right.slice(rightCursor, rightEnd);
    const length = Math.max(leftRun.length, rightRun.length);
    for (let index = 0; index < length; index += 1) {
      pairs.push({
        left: leftRun[index] ?? null,
        right: rightRun[index] ?? null,
      });
    }
  };

  for (const [leftIndex, rightIndex] of anchors) {
    pushGap(leftIndex, rightIndex);
    pairs.push({ left: left[leftIndex] ?? null, right: right[rightIndex] ?? null });
    leftCursor = leftIndex + 1;
    rightCursor = rightIndex + 1;
  }
  pushGap(left.length, right.length);

  return pairs;
}

function buildMergeRows(
  file: ConflictFile,
  choices: Record<string, Choice>,
  lineSelections: LineSelections,
): MergeRow[] {
  const content = file.content ?? '';
  const contentLines = content.replace(/\r\n/g, '\n').split('\n');
  const rows: MergeRow[] = [];
  let cursor = 0;
  let oursLine = 1;
  let resultLine = 1;
  let theirsLine = 1;

  const pushContext = (text: string) => {
    rows.push({
      id: `context:${resultLine}`,
      rowKey: `context:${resultLine}`,
      rowIndex: -1,
      kind: 'context',
      selection: 'ours',
      blockId: null,
      changed: false,
      ours: { text, line: oursLine },
      result: { text, line: resultLine },
      theirs: { text, line: theirsLine },
    });
    oursLine += 1;
    resultLine += 1;
    theirsLine += 1;
  };

  for (const block of file.blocks) {
    const start = block.startLine - 1;
    const end = block.endLine;
    for (const line of contentLines.slice(cursor, start)) pushContext(line);

    const left = splitBlockLines(block.ours);
    const right = splitBlockLines(block.theirs);
    const blockKey = `${file.path}:${block.id}`;
    const blockChoice = choices[blockKey] ?? 'ours';
    const rawResult =
      blockChoice === 'ours'
        ? block.ours
        : blockChoice === 'theirs'
          ? block.theirs
          : blockChoice === 'both'
            ? [block.ours, block.theirs].filter(Boolean).join('\n')
            : (block.base ?? '');
    const resultLines = splitBlockLines(rawResult);
    const pairs = alignBlockLines(left, right);
    const rowCount = Math.max(pairs.length, resultLines.length);

    for (let index = 0; index < rowCount; index += 1) {
      const pair = pairs[index];
      const rowKey = `${blockKey}:${index}`;
      const lineChoice = lineSelections[rowKey];
      const resultText =
        lineChoice === 'ours'
          ? (pair?.left ?? null)
          : lineChoice === 'theirs'
            ? (pair?.right ?? null)
            : blockChoice === 'ours'
              ? (pair?.left ?? null)
              : blockChoice === 'theirs'
                ? (pair?.right ?? null)
                : (resultLines[index] ?? null);
      const selection = lineChoice ?? blockChoice;
      const changed = pair
        ? pair.left === null || pair.right === null || pair.left !== pair.right
        : resultText !== null;

      const row: MergeRow = {
        id: `${block.id}:${index}`,
        rowKey,
        rowIndex: index,
        kind: changed ? selection : 'context',
        selection,
        blockId: block.id,
        changed,
        ours:
          pair?.left !== null && pair?.left !== undefined
            ? { text: pair.left, line: oursLine }
            : null,
        result: resultText !== null ? { text: resultText, line: resultLine } : null,
        theirs:
          pair?.right !== null && pair?.right !== undefined
            ? { text: pair.right, line: theirsLine }
            : null,
      };
      rows.push(row);

      if (row.ours) oursLine += 1;
      if (row.result) resultLine += 1;
      if (row.theirs) theirsLine += 1;
    }

    cursor = end;
  }

  for (const line of contentLines.slice(cursor)) pushContext(line);

  return rows;
}

function MergeLine({
  cell,
  className,
  accepted,
  acceptSide,
  acceptLabel,
  onAccept,
}: {
  cell: MergeCell | null;
  className?: string;
  accepted?: boolean;
  acceptSide?: LineChoice;
  acceptLabel?: string;
  onAccept?: () => void;
}) {
  const hasAccept = Boolean(cell && onAccept && acceptSide);

  return (
    <div
      className={cn(
        'relative flex min-w-0 items-start gap-2 border-r border-edge/30 px-2 py-0.5',
        hasAccept && acceptSide === 'ours' && 'pr-9',
        hasAccept && acceptSide === 'theirs' && 'pl-9',
        className,
      )}
    >
      {hasAccept && acceptSide === 'theirs' ? (
        <button
          type="button"
          className={cn(
            'absolute inset-y-0 left-0 flex w-8 items-center justify-center border-r border-edge/30 text-faint transition-colors hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            accepted && 'bg-warning/10 text-warning',
          )}
          title={acceptLabel}
          aria-label={acceptLabel}
          aria-pressed={accepted}
          onClick={onAccept}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <span className="w-8 shrink-0 select-none text-right text-[10px] leading-5 text-faint">
        {cell?.line ?? ''}
      </span>
      <span
        className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-xs leading-5 text-muted [overflow-wrap:anywhere]"
        title={cell?.text}
      >
        {cell?.text || ' '}
      </span>
      {hasAccept && acceptSide === 'ours' ? (
        <button
          type="button"
          className={cn(
            'absolute inset-y-0 right-0 flex w-8 items-center justify-center border-l border-edge/30 text-faint transition-colors hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            accepted && 'bg-accent/10 text-accent',
          )}
          title={acceptLabel}
          aria-label={acceptLabel}
          aria-pressed={accepted}
          onClick={onAccept}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function ConflictsView() {
  const conflicts = useQuery({
    queryKey: ['conflicts'],
    queryFn: api.conflicts,
    refetchInterval: 6_000,
  });
  const { busy, run } = useAction();
  const setView = useStore((state) => state.setView);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [lineSelections, setLineSelections] = useState<LineSelections>({});
  const [manualContent, setManualContent] = useState<Record<string, string>>({});
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  const files = useMemo(() => conflicts.data?.files ?? [], [conflicts.data]);
  const file = files.find((entry) => entry.path === selectedPath) ?? files[0] ?? null;

  useEffect(() => {
    if (!selectedPath && files[0]) setSelectedPath(files[0].path);
  }, [files, selectedPath]);

  const mergeRows = useMemo(
    () => (file && !file.binary ? buildMergeRows(file, choices, lineSelections) : []),
    [file, choices, lineSelections],
  );
  const resolved = useMemo(
    () =>
      mergeRows
        .flatMap((row) => (row.result ? [row.result.text] : []))
        .join('\n'),
    [mergeRows],
  );
  const mergeSections = useMemo(() => {
    const sections: Array<{ blockId: string | null; rows: MergeRow[] }> = [];
    for (const row of mergeRows) {
      const last = sections[sections.length - 1];
      if (last && last.blockId === row.blockId) {
        last.rows.push(row);
      } else {
        sections.push({ blockId: row.blockId, rows: [row] });
      }
    }
    return sections;
  }, [mergeRows]);

  const hasAnyBase = file?.blocks.some((block) => block.base !== null) ?? false;
  const legendOptions: Choice[] = hasAnyBase
    ? ['ours', 'theirs', 'both', 'base']
    : ['ours', 'theirs', 'both'];

  const chooseAll = (choice: Choice) => {
    if (!file) return;
    setChoices((current) => {
      const next = { ...current };
      for (const block of file.blocks) next[`${file.path}:${block.id}`] = choice;
      return next;
    });
    setLineSelections({});
  };

  const applyBlockChoice = (block: ConflictBlock, choice: Choice) => {
    if (!file) return;
    const blockKey = `${file.path}:${block.id}`;
    const rowPrefix = `${blockKey}:`;
    setChoices((current) => ({ ...current, [blockKey]: choice }));
    setLineSelections((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(rowPrefix)) delete next[key];
      }
      return next;
    });
  };

  const acceptLine = (row: MergeRow, side: LineChoice) => {
    setLineSelections((current) => ({ ...current, [row.rowKey]: side }));
  };

  const save = async () => {
    if (!file) return;
    const result = await run(
      () => api.resolveConflict(file.path, resolved),
      `Resolved ${file.path}.`,
    );
    if (result) {
      setSelectedPath(null);
      const remaining = files.filter((entry) => entry.path !== file.path);
      if (remaining.length === 0) setView('changes');
    }
  };

  const renderMergeRow = (row: MergeRow, interactive: boolean) => {
    const meta = row.kind === 'context' ? null : SEGMENT_META[row.kind];
    const oursAccepted =
      row.selection === 'ours' || row.selection === 'both';
    const theirsAccepted =
      row.selection === 'theirs' || row.selection === 'both';
    const canAcceptOurs = interactive && row.changed && row.ours !== null;
    const canAcceptTheirs = interactive && row.changed && row.theirs !== null;

    return (
      <div key={row.id} className="grid grid-cols-3 border-b border-edge/20">
        <MergeLine
          cell={row.ours}
          accepted={oursAccepted}
          acceptSide="ours"
          acceptLabel={
            row.ours ? `Accept local line ${row.ours.line}` : undefined
          }
          onAccept={canAcceptOurs ? () => acceptLine(row, 'ours') : undefined}
          className={cn(
            canAcceptOurs && oursAccepted && 'bg-accent/10',
            canAcceptOurs && !oursAccepted && 'bg-accent/[0.03]',
          )}
        />
        <MergeLine
          cell={row.result}
          className={cn(
            'border-l-2',
            meta ? meta.border : 'border-l-transparent',
            meta?.background,
          )}
        />
        <MergeLine
          cell={row.theirs}
          accepted={theirsAccepted}
          acceptSide="theirs"
          acceptLabel={
            row.theirs ? `Accept server line ${row.theirs.line}` : undefined
          }
          onAccept={canAcceptTheirs ? () => acceptLine(row, 'theirs') : undefined}
          className={cn(
            canAcceptTheirs && theirsAccepted && 'bg-warning/10',
            canAcceptTheirs && !theirsAccepted && 'bg-warning/[0.03]',
          )}
        />
      </div>
    );
  };

  if (conflicts.isLoading) return <LoadingState label="Loading conflicts..." />;
  if (conflicts.isError) {
    return <ErrorState error={conflicts.error} retry={() => void conflicts.refetch()} />;
  }

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<Check className="h-8 w-8 text-success" />}
        title="No unresolved conflicts"
        description={
          conflicts.data?.operation
            ? 'All conflicts are resolved. Continue the operation from the banner above.'
            : 'There is no merge, rebase, or cherry-pick in progress.'
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-panel">
      {filesCollapsed ? (
        <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-edge py-2">
          <button
            type="button"
            className="btn-icon"
            title="Show conflicted files"
            aria-label="Expand conflicted files"
            onClick={() => setFilesCollapsed(false)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <span className="badge badge-danger">{files.length}</span>
        </div>
      ) : (
        <div className="flex w-[20rem] shrink-0 flex-col border-r border-edge">
          <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <span className="text-sm font-medium">Conflicted files</span>
            <span className="badge badge-danger">{files.length}</span>
            <button
              type="button"
              className="btn-icon ml-auto h-6 w-6"
              title="Hide conflicted files"
              aria-label="Collapse conflicted files"
              onClick={() => setFilesCollapsed(true)}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {files.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 border-b border-edge/60 px-3 py-2 text-left hover:bg-raised/50',
                  file?.path === entry.path && 'bg-raised',
                )}
                onClick={() => setSelectedPath(entry.path)}
              >
                <FileWarning className="h-4 w-4 shrink-0 text-danger" />
                <PathText text={entry.path} className="min-w-0 flex-1 text-xs text-ink" />
                {entry.binary ? <span className="badge">binary</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <PathText text={file.path} className="min-w-0 flex-1 font-mono text-xs text-muted" />
              {!file.binary && file.blocks.length > 0 ? (
                <>
                  <span className="badge">{file.blocks.length} chunks</span>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('ours')}>
                    Ours all
                  </button>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('theirs')}>
                    Theirs all
                  </button>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('both')}>
                    Both all
                  </button>
                </>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {!file.binary && file.blocks.length > 0 ? (
                  <span className="hidden text-[11px] text-faint lg:inline">
                    Use the arrows to accept lines or chunks.
                  </span>
                ) : null}
                {!file.binary && file.blocks.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary h-7 text-xs"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    {busy ? <Spinner /> : null}
                    Save resolution
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                'scrollbar-thin min-h-0 flex-1 overflow-auto',
                file.binary || file.blocks.length === 0 ? 'p-3' : 'bg-canvas/40',
              )}
            >
              {file.binary ? (
                <div className="mx-auto mt-10 max-w-lg space-y-4 rounded-lg border border-edge bg-canvas p-5 text-center">
                  <FileWarning className="mx-auto h-8 w-8 text-danger" />
                  <p className="text-sm text-muted">
                    This is a binary conflict. Choose which side should win.
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.resolveBinaryConflict(file.path, 'ours'),
                          'Binary conflict resolved with ours.',
                        )
                      }
                    >
                      Use ours
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.resolveBinaryConflict(file.path, 'theirs'),
                          'Binary conflict resolved with theirs.',
                        )
                      }
                    >
                      Use theirs
                    </button>
                  </div>
                </div>
              ) : file.blocks.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-warning">
                    No conflict markers were found. Edit the file manually and save.
                  </p>
                  <textarea
                    className="input min-h-[28rem] font-mono text-xs"
                    value={manualContent[file.path] ?? file.content ?? ''}
                    onChange={(event) =>
                      setManualContent((current) => ({
                        ...current,
                        [file.path]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.resolveConflict(
                            file.path,
                            manualContent[file.path] ?? file.content ?? '',
                          ),
                        'File resolved.',
                      )
                    }
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="sticky top-0 z-10 grid grid-cols-3 border-b border-edge bg-panel text-[10px] font-semibold uppercase tracking-wide">
                    <div className="border-r border-edge/60 px-3 py-1.5 text-accent">
                      Local Changes{' '}
                      <span className="font-normal normal-case tracking-normal text-faint">(Ours)</span>
                    </div>
                    <div className="border-r border-edge/60 px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink">Result</span>
                        <div className="ml-auto flex flex-wrap items-center gap-2 font-normal normal-case tracking-normal">
                          {legendOptions.map((option) => (
                            <span
                              key={option}
                              className="inline-flex items-center gap-1 text-[10px] text-muted"
                            >
                              <span
                                className={cn('h-1.5 w-1.5 rounded-full', SEGMENT_META[option].dot)}
                              />
                              {SEGMENT_META[option].label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 text-warning">
                      Changes from Server{' '}
                      <span className="font-normal normal-case tracking-normal text-faint">
                        (Theirs)
                      </span>
                    </div>
                  </div>

                  {mergeSections.map((section) => {
                    if (!section.blockId) {
                      return (
                        <div key={section.rows[0]?.id ?? 'context'}>
                          {section.rows.map((row) => renderMergeRow(row, false))}
                        </div>
                      );
                    }

                    const block = file.blocks.find((entry) => entry.id === section.blockId);
                    if (!block) return null;
                    const blockIndex =
                      file.blocks.findIndex((entry) => entry.id === block.id) + 1;
                    const blockKey = `${file.path}:${block.id}`;
                    const choice = choices[blockKey] ?? 'ours';
                    const hasCustom = section.rows.some(
                      (row) => lineSelections[row.rowKey] !== undefined,
                    );

                    return (
                      <div
                        key={section.blockId}
                        className="border border-accent/30 bg-accent/[0.015]"
                      >
                        <div className="grid grid-cols-3 border-b border-accent/30 bg-accent/[0.05]">
                          <div className="flex items-center justify-end gap-2 border-r border-edge/30 px-2 py-1">
                            <span className="mr-auto text-[10px] uppercase tracking-wide text-accent/80">
                              Ours
                            </span>
                            <button
                              type="button"
                              className={cn(
                                'btn btn-ghost h-6 px-2 text-[10px]',
                                choice === 'ours' && !hasCustom && 'bg-accent/15 text-accent',
                              )}
                              title="Accept the whole chunk from ours"
                              aria-label={`Accept ours chunk ${blockIndex}`}
                              onClick={() => applyBlockChoice(block, 'ours')}
                            >
                              Accept
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-1.5 border-r border-edge/30 px-2 py-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink">
                              Conflict {blockIndex}
                            </span>
                            <span className="text-[10px] text-faint">
                              lines {block.startLine}-{block.endLine}
                            </span>
                            {hasCustom ? <span className="badge">custom</span> : null}
                            <button
                              type="button"
                              className={cn(
                                'btn btn-ghost h-6 px-2 text-[10px]',
                                choice === 'both' && !hasCustom && 'bg-success/15 text-success',
                              )}
                              title="Include both sides for the whole chunk"
                              aria-label={`Accept both chunk ${blockIndex}`}
                              onClick={() => applyBlockChoice(block, 'both')}
                            >
                              Both
                            </button>
                            {block.base !== null ? (
                              <button
                                type="button"
                                className={cn(
                                  'btn btn-ghost h-6 px-2 text-[10px]',
                                  choice === 'base' && !hasCustom && 'bg-raised text-ink',
                                )}
                                title="Use the merge base for the whole chunk"
                                aria-label={`Accept base chunk ${blockIndex}`}
                                onClick={() => applyBlockChoice(block, 'base')}
                              >
                                Base
                              </button>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1">
                            <button
                              type="button"
                              className={cn(
                                'btn btn-ghost h-6 px-2 text-[10px]',
                                choice === 'theirs' && !hasCustom && 'bg-warning/15 text-warning',
                              )}
                              title="Accept the whole chunk from theirs"
                              aria-label={`Accept theirs chunk ${blockIndex}`}
                              onClick={() => applyBlockChoice(block, 'theirs')}
                            >
                              <ArrowLeft className="h-3.5 w-3.5" />
                              Accept
                            </button>
                            <span className="ml-auto text-[10px] uppercase tracking-wide text-warning/80">
                              Theirs
                            </span>
                          </div>
                        </div>
                        {section.rows.map((row) => renderMergeRow(row, true))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
