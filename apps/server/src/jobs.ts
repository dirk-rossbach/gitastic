import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Job } from '@gitastic/shared';
import { errorMessage } from './errors';

export interface JobContext {
  signal: AbortSignal;
  progress: (value: number, message?: string) => void;
  output: (line: string) => void;
}

type JobListener = (job: Job) => void;

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly controllers = new Map<string, AbortController>();

  start(
    type: string,
    repoId: string | null,
    task: (context: JobContext) => Promise<unknown>,
  ): Job {
    const id = randomUUID();
    const job: Job = {
      id,
      type,
      repoId,
      status: 'queued',
      progress: null,
      message: 'Queued',
      output: [],
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
    };
    this.jobs.set(id, job);
    const emitter = new EventEmitter();
    this.emitters.set(id, emitter);
    const controller = new AbortController();
    this.controllers.set(id, controller);

    setImmediate(async () => {
      job.status = 'running';
      job.message = 'Running';
      this.emit(id);

      try {
        const result = await task({
          signal: controller.signal,
          progress: (value, message) => {
            job.progress = Math.max(0, Math.min(1, value));
            if (message) job.message = message;
            this.emit(id);
          },
          output: (line) => {
            const trimmed = line.trimEnd();
            if (!trimmed) return;
            job.output.push(trimmed);
            if (job.output.length > 800) job.output.shift();
            const progressMatch = trimmed.match(/(\d+)%/);
            if (progressMatch) job.progress = Number(progressMatch[1]) / 100;
            job.message = trimmed;
            this.emit(id);
          },
        });
        job.status = 'done';
        job.progress = 1;
        job.result = result ?? null;
        job.message = 'Done';
        job.finishedAt = new Date().toISOString();
      } catch (error) {
        if (controller.signal.aborted) {
          job.status = 'cancelled';
          job.message = 'Cancelled';
        } else {
          job.status = 'error';
          job.error = errorMessage(error);
          job.message = 'Failed';
        }
        job.finishedAt = new Date().toISOString();
      }

      this.emit(id);
      emitter.emit('end', job);
    });

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  subscribe(id: string, listener: JobListener): () => void {
    const emitter = this.emitters.get(id);
    if (!emitter) return () => undefined;
    emitter.on('update', listener);
    return () => emitter.off('update', listener);
  }

  onEnd(id: string, listener: JobListener): () => void {
    const emitter = this.emitters.get(id);
    if (!emitter) return () => undefined;
    emitter.on('end', listener);
    return () => emitter.off('end', listener);
  }

  private emit(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.emitters.get(id)?.emit('update', job);
  }
}
