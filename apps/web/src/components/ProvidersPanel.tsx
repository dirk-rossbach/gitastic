import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { ProviderKind, ProviderRepo, SshKeyEntry } from '@gitastic/shared';
import { ApiError, api } from '../api';
import { useAction, useDebouncedValue, useStartJob } from '../lib/hooks';
import { cn, errorMessage, formatDate } from '../lib/utils';
import { useStore } from '../store';
import { Modal, Spinner } from './ui';

const PROVIDER_SCOPES: Record<ProviderKind, string[]> = {
  github: ['repo', 'read:org'],
  gitlab: ['read_api', 'read_repository', 'write_repository'],
};

function providerScopes(provider: ProviderKind) {
  return PROVIDER_SCOPES[provider].join(', ');
}

export function ProviderAuthAssistant() {
  const queryClient = useQueryClient();
  const notify = useStore((state) => state.notify);
  const { busy, run } = useAction();
  const status = useQuery({
    queryKey: ['providers-status'],
    queryFn: api.providersStatus,
  });

  const [connectModal, setConnectModal] = useState<{
    provider: ProviderKind;
    host: string;
  } | null>(null);
  const [hostInput, setHostInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [passphraseKey, setPassphraseKey] = useState<SshKeyEntry | null>(null);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const handleLoadSshKey = async (key: SshKeyEntry, passphrase?: string) => {
    setUnlocking(true);
    try {
      await api.addSshKey(key.path, passphrase);
      await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      notify('success', `Loaded ${key.name} into ssh-agent.`);
      setPassphraseKey(null);
      setPassphraseInput('');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SSH_PASSPHRASE_REQUIRED') {
        setPassphraseKey(key);
        setPassphraseInput('');
      } else {
        notify('error', errorMessage(error));
      }
    } finally {
      setUnlocking(false);
    }
  };

  const openConnect = (provider: ProviderKind, defaultHost: string) => {
    setConnectModal({ provider, host: defaultHost });
    setHostInput(defaultHost);
    setTokenInput('');
  };

  const handleConnect = async () => {
    if (!connectModal || !tokenInput.trim()) return;
    const result = await run(
      async () => {
        const res = await api.connectProvider({
          provider: connectModal.provider,
          host: hostInput.trim() || connectModal.host,
          token: tokenInput.trim(),
        });
        await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
        await queryClient.invalidateQueries({ queryKey: ['provider-repos'] });
        await queryClient.invalidateQueries({ queryKey: ['repo-pulls'] });
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        return res;
      },
      `Connected to ${hostInput.trim() || connectModal.host}.`,
    );
    if (result) {
      setConnectModal(null);
      setTokenInput('');
    }
  };

  const handleDisconnect = async (provider: ProviderKind, host: string) => {
    await run(
      async () => {
        await api.disconnectProvider({ provider, host });
        await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
        await queryClient.invalidateQueries({ queryKey: ['provider-repos'] });
      },
      `Disconnected from ${host}.`,
    );
  };

  const accounts = status.data?.accounts ?? [];
  const sshKeys = status.data?.sshKeys ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">GitHub & GitLab Accounts</h3>
          <p className="text-xs text-muted">
            Tokens are stored exclusively in your OS credential helper / CLI keyring — never in Gitastic files.
          </p>
        </div>
        <button
          type="button"
          className="btn-icon h-7 w-7"
          title="Refresh auth status"
          onClick={() => void status.refetch()}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', status.isFetching && 'animate-spin')} />
        </button>
      </div>

      {status.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Spinner /> Checking GitHub, GitLab & SSH status...
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {accounts.map((account) => (
            <div
              key={`${account.provider}-${account.host}`}
              className={cn(
                'flex flex-col justify-between gap-3 rounded-lg border p-3 transition',
                account.connected
                  ? 'border-success/35 bg-success/5'
                  : 'border-edge bg-raised/40',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-4 w-4 shrink-0 text-accent" />
                    <span className="truncate text-sm font-semibold capitalize text-ink">
                      {account.provider}
                    </span>
                    <span className="badge font-mono text-[10px]">{account.host}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {account.connected ? (
                      account.detail
                    ) : (
                      <>
                        Connect with a Personal Access Token. Required scopes:{' '}
                        <code className="font-mono text-ink">
                          {providerScopes(account.provider)}
                        </code>
                      </>
                    )}
                  </p>
                </div>
                {account.connected ? (
                  <span className="badge badge-success shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </span>
                ) : (
                  <span className="badge shrink-0">Not connected</span>
                )}
              </div>

              <div className="flex items-center justify-end gap-1.5">
                {account.connected ? (
                  <>
                    <button
                      type="button"
                      className="btn h-7 text-xs"
                      onClick={() => openConnect(account.provider, account.host)}
                    >
                      Update token
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 text-xs text-danger hover:text-danger"
                      disabled={busy}
                      onClick={() => void handleDisconnect(account.provider, account.host)}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary h-7 text-xs"
                    onClick={() => openConnect(account.provider, account.host)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Connect {account.provider === 'github' ? 'GitHub' : 'GitLab'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-edge bg-raised/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink">SSH Keys</h4>
              <p className="text-[11px] text-faint">
                Keys in <code className="font-mono">~/.ssh</code>. Copy a public key to{' '}
                <a
                  href="https://github.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  GitHub
                </a>{' '}
                or{' '}
                <a
                  href="https://gitlab.com/-/user_settings/ssh_keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  GitLab
                </a>
                {', or load it into the agent.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost h-7 text-xs"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.generateSshKey();
                await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
                await queryClient.invalidateQueries({ queryKey: ['session'] });
              }, 'SSH key generated and loaded into ssh-agent.')
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Generate
          </button>
        </div>

        {sshKeys.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            No SSH keys found in <code className="font-mono">~/.ssh</code>.
          </p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {sshKeys.map((key) => (
              <div
                key={key.path}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge/70 bg-panel/70 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="truncate font-mono text-xs font-medium text-ink"
                    title={key.path}
                  >
                    {key.name}
                  </span>
                  {key.loaded ? (
                    <span className="badge badge-success">loaded</span>
                  ) : (
                    <span className="badge">not loaded</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {key.publicKey ? (
                    <button
                      type="button"
                      className="btn btn-ghost h-7 px-2 text-xs"
                      title="Copy public key"
                      onClick={() => {
                        void navigator.clipboard.writeText(key.publicKey!).then(() => {
                          setCopiedKey(key.name);
                          setTimeout(() => setCopiedKey(null), 1500);
                        });
                      }}
                    >
                      {copiedKey === key.name ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedKey === key.name ? 'Copied' : 'Copy'}
                    </button>
                  ) : null}
                  {!key.loaded ? (
                    <button
                      type="button"
                      className="btn h-7 px-2 text-xs"
                      disabled={busy || unlocking}
                      onClick={() => void handleLoadSshKey(key)}
                    >
                      Load
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost h-7 px-2 text-xs text-muted hover:text-ink"
                      disabled={busy || unlocking}
                      onClick={() =>
                        void run(async () => {
                          await api.removeSshKey(key.path, false);
                          await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
                          await queryClient.invalidateQueries({ queryKey: ['session'] });
                        }, `Unloaded ${key.name} from ssh-agent.`)
                      }
                    >
                      Unload
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={connectModal !== null}
        onOpenChange={(open) => {
          if (!open) setConnectModal(null);
        }}
        title={
          connectModal?.provider === 'github'
            ? 'Connect GitHub Account'
            : 'Connect GitLab Account'
        }
        description="Your Personal Access Token is verified and saved directly into your system Git credential manager (never stored in Gitastic)."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConnectModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !tokenInput.trim()}
              onClick={() => void handleConnect()}
            >
              {busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
              Verify & Connect
            </button>
          </>
        }
      >
        {connectModal ? (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Host
              </span>
              <input
                className="input font-mono text-xs"
                value={hostInput}
                onChange={(event) => setHostInput(event.target.value)}
                placeholder={connectModal.provider === 'github' ? 'github.com' : 'gitlab.com'}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Personal Access Token
              </span>
              <input
                type="password"
                className="input font-mono text-xs"
                autoFocus
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder={
                  connectModal.provider === 'github' ? 'ghp_... or github_pat_...' : 'glpat-...'
                }
              />
            </label>
            <div className="flex items-center justify-between rounded-md border border-edge bg-raised/40 px-3 py-2 text-xs text-muted">
              <span>
                Required scopes:{' '}
                <code className="font-mono text-ink">
                  {providerScopes(connectModal.provider)}
                </code>
              </span>
              <a
                href={
                  connectModal.provider === 'github'
                    ? `https://${hostInput.trim() || 'github.com'}/settings/tokens/new?scopes=${providerScopes('github')}&description=Gitastic`
                    : `https://${hostInput.trim() || 'gitlab.com'}/-/user_settings/personal_access_tokens?name=Gitastic&scopes=${providerScopes('gitlab')}`
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                Create token
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={passphraseKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPassphraseKey(null);
            setPassphraseInput('');
          }
        }}
        title={passphraseKey ? `Unlock SSH Key (${passphraseKey.name})` : 'Unlock SSH Key'}
        description="This SSH key is protected by a passphrase. Enter it once to load the key into ssh-agent and store it in your macOS Keychain."
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPassphraseKey(null);
                setPassphraseInput('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={unlocking || !passphraseInput}
              onClick={() => {
                if (passphraseKey) {
                  void handleLoadSshKey(passphraseKey, passphraseInput);
                }
              }}
            >
              {unlocking ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              Unlock & Load
            </button>
          </>
        }
      >
        {passphraseKey ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Passphrase for {passphraseKey.path}
            </span>
            <input
              type="password"
              className="input font-mono text-xs"
              autoFocus
              value={passphraseInput}
              placeholder="SSH key passphrase"
              onChange={(event) => setPassphraseInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && passphraseInput) {
                  void handleLoadSshKey(passphraseKey, passphraseInput);
                }
              }}
            />
          </label>
        ) : null}
      </Modal>
    </div>
  );
}

export function ProviderRepoBrowser({
  cloneBaseDir,
  onSelectRepo,
}: {
  cloneBaseDir: string;
  onSelectRepo: (url: string, targetPath: string) => void;
}) {
  const startJob = useStartJob();
  const openSettings = useStore((state) => state.openSettings);
  const [provider, setProvider] = useState<ProviderKind>('github');
  const [host, setHost] = useState('github.com');
  const [protocol, setProtocol] = useState<'https' | 'ssh'>('https');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const status = useQuery({
    queryKey: ['providers-status'],
    queryFn: api.providersStatus,
  });

  const repos = useQuery({
    queryKey: ['provider-repos', provider, host, debouncedSearch],
    queryFn: () =>
      api.providerRepos({
        provider,
        host: host.trim() || undefined,
        q: debouncedSearch || undefined,
      }),
    retry: false,
  });

  const switchProvider = (next: ProviderKind) => {
    setProvider(next);
    setHost(next === 'github' ? 'github.com' : 'gitlab.com');
  };

  const targetFor = (repo: ProviderRepo) => {
    const cleanBase = cloneBaseDir.replace(/\/+$/, '') || '/tmp';
    return `${cleanBase}/${repo.name}`;
  };

  const urlFor = (repo: ProviderRepo) => (protocol === 'ssh' ? repo.sshUrl : repo.cloneUrl);

  const connectedAccount = status.data?.accounts.find(
    (acc) => acc.provider === provider && acc.host.toLowerCase() === host.trim().toLowerCase(),
  );

  return (
    <div className="space-y-3 rounded-lg border border-edge bg-raised/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-edge bg-panel p-0.5">
          <button
            type="button"
            className={cn(
              'btn h-7 border-0 px-2.5 text-xs',
              provider === 'github' ? 'btn-primary' : 'btn-ghost',
            )}
            onClick={() => switchProvider('github')}
          >
            GitHub
          </button>
          <button
            type="button"
            className={cn(
              'btn h-7 border-0 px-2.5 text-xs',
              provider === 'gitlab' ? 'btn-primary' : 'btn-ghost',
            )}
            onClick={() => switchProvider('gitlab')}
          >
            GitLab
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-edge bg-panel p-0.5 text-xs">
            <button
              type="button"
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition',
                protocol === 'https' ? 'bg-raised text-ink' : 'text-muted',
              )}
              onClick={() => setProtocol('https')}
            >
              HTTPS
            </button>
            <button
              type="button"
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition',
                protocol === 'ssh' ? 'bg-raised text-ink' : 'text-muted',
              )}
              onClick={() => setProtocol('ssh')}
            >
              SSH
            </button>
          </div>
          <button
            type="button"
            className="btn h-7 text-xs"
            onClick={openSettings}
            title="Manage tokens & SSH keys in Settings"
          >
            <Settings className="h-3.5 w-3.5" />
            {connectedAccount?.connected
              ? `@${connectedAccount.username ?? connectedAccount.host}`
              : 'Tokens & SSH'}
          </button>
          <button
            type="button"
            className="btn-icon h-7 w-7"
            title="Refresh repositories"
            onClick={() => void repos.refetch()}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', repos.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            className="input h-8 pl-8 text-xs"
            placeholder={`Search ${provider === 'github' ? 'GitHub' : 'GitLab'} repositories...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <input
          className="input h-8 font-mono text-xs"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder={provider === 'github' ? 'github.com' : 'gitlab.com'}
          title="Provider hostname (supports self-hosted instances)"
        />
      </div>

      <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-md border border-edge bg-panel/70">
        {repos.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted">
            <Spinner /> Loading {provider === 'github' ? 'GitHub' : 'GitLab'} repositories...
          </div>
        ) : repos.isError ? (
          <div className="flex flex-col items-center justify-center gap-2 p-5 text-center">
            <p className="text-xs text-muted">{errorMessage(repos.error)}</p>
            <button
              type="button"
              className="btn btn-primary h-7 text-xs"
              onClick={openSettings}
            >
              <Settings className="h-3.5 w-3.5" />
              Manage Tokens & SSH in Settings
            </button>
          </div>
        ) : repos.data && repos.data.length === 0 ? (
          <p className="p-5 text-center text-xs text-muted">No matching repositories found.</p>
        ) : (
          repos.data?.map((repo) => (
            <div
              key={repo.id}
              className="flex items-center justify-between gap-2 border-b border-edge/60 px-3 py-2 last:border-0 hover:bg-raised/60"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectRepo(urlFor(repo), targetFor(repo))}
              >
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate text-xs font-semibold text-ink">
                    {repo.fullName}
                  </span>
                  {repo.private ? (
                    <span className="badge text-[10px]">
                      <Lock className="h-2.5 w-2.5" />
                      private
                    </span>
                  ) : null}
                </div>
                {repo.description ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted">{repo.description}</p>
                ) : null}
                <p className="mt-0.5 text-[10px] text-faint">
                  {repo.defaultBranch ? `${repo.defaultBranch} · ` : ''}
                  {repo.updatedAt ? formatDate(repo.updatedAt) : repo.host}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={repo.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-icon h-7 w-7"
                  title="Open in browser"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  className="btn btn-primary h-7 px-2.5 text-xs"
                  title={`Clone into ${targetFor(repo)}`}
                  onClick={() => {
                    const url = urlFor(repo);
                    const target = targetFor(repo);
                    onSelectRepo(url, target);
                    void startJob(api.clone(url, target));
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  1-Click Clone
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
