import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export type GlossaryTerm =
  | 'repository'
  | 'branch'
  | 'commit'
  | 'head'
  | 'staging'
  | 'merge'
  | 'rebase'
  | 'interactive-rebase'
  | 'pull-request'
  | 'review'
  | 'conflict'
  | 'stash'
  | 'tag'
  | 'worktree'
  | 'remote'
  | 'theme';

const GLOSSARY: Record<GlossaryTerm, { title: string; body: ReactNode }> = {
  repository: {
    title: 'Repository',
    body: (
      <>
        A repository (repo) is the folder that Git tracks. It contains your files plus a hidden
        history of every commit, branch and tag.
      </>
    ),
  },
  branch: {
    title: 'Branch',
    body: (
      <>
        A branch is a movable pointer to a line of commits. You use branches to work on something
        without changing <em>main</em> until you are ready to merge it back.
      </>
    ),
  },
  commit: {
    title: 'Commit',
    body: (
      <>
        A commit is a saved snapshot of your project with a message. Each commit has a unique hash
        and points to the commit before it, which is how Git builds history.
      </>
    ),
  },
  head: {
    title: 'HEAD',
    body: (
      <>
        <em>HEAD</em> is Git's name for “where you are right now”. Usually it points at the tip of the
        branch you checked out.
      </>
    ),
  },
  staging: {
    title: 'Staging',
    body: (
      <>
        Staging marks the changes you want in your next commit. You can stage a whole file, a group
        of lines or a single line, leaving everything else out.
      </>
    ),
  },
  merge: {
    title: 'Merge',
    body: (
      <>
        A merge combines the commits of another branch into your current branch. If both branches
        changed the same lines, Git asks you to resolve a conflict.
      </>
    ),
  },
  rebase: {
    title: 'Rebase',
    body: (
      <>
        A rebase moves your commits onto a new base, as if you had started from there. It rewrites
        commit hashes, so use it on branches you have not shared with others yet.
      </>
    ),
  },
  'interactive-rebase': {
    title: 'Interactive rebase',
    body: (
      <>
        An interactive rebase lets you edit a range of commits: reorder them, change messages or
        combine and remove commits before they land. Actions: <strong>pick</strong> keeps a commit,{' '}
        <strong>reword</strong> changes its message, <strong>squash</strong> combines it with the
        previous commit, <strong>fixup</strong> combines and drops the message, <strong>drop</strong>{' '}
        removes it.
      </>
    ),
  },
  'pull-request': {
    title: 'Pull request / merge request',
    body: (
      <>
        A pull request (GitHub) or merge request (GitLab) asks the project to pull your branch into
        another one, usually <em>main</em>. It is where the change gets reviewed and discussed before
        it is merged.
      </>
    ),
  },
  review: {
    title: 'Code review',
    body: (
      <>
        A review is feedback on a pull request. Reviewers can comment, approve the change or request
        more work before it is merged.
      </>
    ),
  },
  conflict: {
    title: 'Merge conflict',
    body: (
      <>
        A conflict happens when two branches changed the same place and Git cannot decide which
        version wins. You choose the result, then continue the merge, rebase or cherry-pick.
      </>
    ),
  },
  stash: {
    title: 'Stash',
    body: (
      <>
        A stash temporarily shelves changes you are not ready to commit, so you can switch branches
        and bring them back later.
      </>
    ),
  },
  tag: {
    title: 'Tag',
    body: (
      <>
        A tag is a permanent label on a commit, often used for releases such as <em>v1.3.0</em>.
        Unlike a branch, a tag does not move.
      </>
    ),
  },
  worktree: {
    title: 'Worktree',
    body: (
      <>
        A worktree is an extra working folder linked to the same repository, so you can have several
        branches checked out at the same time.
      </>
    ),
  },
  remote: {
    title: 'Remote',
    body: (
      <>
        A remote is a copy of the repository on a server, usually named <em>origin</em> (GitHub or
        GitLab). You push your commits there and pull other people's work back.
      </>
    ),
  },
  theme: {
    title: 'Theme',
    body: (
      <>
        A theme controls the colors and fonts of the app. Gitastic ships with 15 built-in styles, and
        you can build, import or install your own under <em>Custom themes</em>.
      </>
    ),
  },
};

export function HelpTip({
  term,
  label,
  className,
}: {
  term: GlossaryTerm;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const entry = GLOSSARY[term];

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
    <span ref={rootRef} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label ?? `What is ${entry.title}?`}
        aria-expanded={open}
        className="help-dot"
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <span role="dialog" className="help-popover">
          <span className="block text-xs font-semibold text-ink">{entry.title}</span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">{entry.body}</span>
        </span>
      ) : null}
    </span>
  );
}
