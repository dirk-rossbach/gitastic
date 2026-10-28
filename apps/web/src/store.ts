import { create } from 'zustand';
import type { Job } from '@gitastic/shared';

export type View =
  | 'history'
  | 'changes'
  | 'branches'
  | 'pulls'
  | 'worktrees'
  | 'tags'
  | 'remotes'
  | 'stashes'
  | 'conflicts'
  | 'blame'
  | 'file-history'
  | 'reflog'
  | 'settings';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  details?: string;
}

interface Store {
  view: View;
  setView: (view: View) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  selectedCommit: string | null;
  setSelectedCommit: (hash: string | null) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  blamePath: string | null;
  openBlame: (path: string) => void;
  fileHistoryPath: string | null;
  openFileHistory: (path: string) => void;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
  refFilter: string | null;
  setRefFilter: (ref: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  job: Job | null;
  setJob: (job: Job | null) => void;
  toasts: Toast[];
  notify: (kind: ToastKind, message: string, details?: string) => void;
  dismissToast: (id: string) => void;
  resetRepoState: () => void;
}

export const useStore = create<Store>((set, get) => ({
  view: 'history',
  setView: (view) =>
    set(() =>
      view === 'settings'
        ? { settingsOpen: true }
        : { view, settingsOpen: false },
    ),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set({ commandPaletteOpen: !get().commandPaletteOpen }),
  selectedCommit: null,
  setSelectedCommit: (selectedCommit) => set({ selectedCommit }),
  selectedFile: null,
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  blamePath: null,
  openBlame: (path) => set({ blamePath: path, view: 'blame' }),
  fileHistoryPath: null,
  openFileHistory: (path) => set({ fileHistoryPath: path, view: 'file-history' }),
  historyQuery: '',
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  refFilter: null,
  setRefFilter: (refFilter) => set({ refFilter }),
  sidebarOpen: true,
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  job: null,
  setJob: (job) => set({ job }),
  toasts: [],
  notify: (kind, message, details) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message, details }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, kind === 'error' ? 9000 : 4500);
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  resetRepoState: () =>
    set({
      view: 'history',
      settingsOpen: false,
      commandPaletteOpen: false,
      selectedCommit: null,
      selectedFile: null,
      blamePath: null,
      fileHistoryPath: null,
      historyQuery: '',
      refFilter: null,
    }),
}));
