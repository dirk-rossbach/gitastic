import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Job } from '@gitastic/shared';
import { ApiError } from '../api';
import { useStore } from '../store';
import { errorMessage } from './utils';

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useAction() {
  const queryClient = useQueryClient();
  const notify = useStore((state) => state.notify);
  const [busy, setBusy] = useState(false);

  const run = async <T,>(
    action: () => Promise<T>,
    successMessage?: string,
    options: { refresh?: boolean } = {},
  ): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await action();
      if (options.refresh !== false) await queryClient.invalidateQueries();
      if (successMessage) notify('success', successMessage);
      return result;
    } catch (error) {
      const details =
        error instanceof ApiError && error.details
          ? typeof error.details === 'string'
            ? error.details
            : JSON.stringify(error.details)
          : undefined;
      notify('error', errorMessage(error), details);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}

export function useStartJob() {
  const setJob = useStore((state) => state.setJob);
  const notify = useStore((state) => state.notify);

  return async (request: Promise<{ job: Job }>): Promise<void> => {
    try {
      const { job } = await request;
      setJob(job);
    } catch (error) {
      notify('error', errorMessage(error));
    }
  };
}
