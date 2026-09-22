import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type JobStatus = 'running' | 'done' | 'failed';

export interface EngineJob {
  id: string;
  kind: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Free-form progress the job reports while it runs, e.g. events derived so far. */
  progress: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
}

export type ReportProgress = (progress: Record<string, unknown>) => void;

/**
 * Long admin operations run in the background, not inside the HTTP request.
 *
 * Deriving thousands of matches or testing every slice takes minutes. Held
 * open that long, the browser's request dies ("Failed to fetch") while the
 * server carries on, so the page reports a failure for work that succeeded —
 * and a second click starts the same work again alongside the first.
 *
 * Here the POST returns at once with a job id, the work carries on in this
 * process, and the page polls for the result. One job of each kind at a time:
 * a second click while one is running is handed the running job instead.
 *
 * Jobs live in memory. A restart loses the record of a running job (and the
 * job itself), which is acceptable for admin work that can simply be rerun.
 */
@Injectable()
export class EngineJobsService {
  private readonly logger = new Logger(EngineJobsService.name);
  private readonly jobs = new Map<string, EngineJob>();
  private readonly KEEP = 50;

  start(kind: string, work: (report: ReportProgress) => Promise<unknown>): EngineJob {
    const running = this.runningOf(kind);
    if (running) return running;

    const job: EngineJob = {
      id: randomUUID(),
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      progress: null,
      result: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this.prune();

    const report: ReportProgress = (progress) => {
      job.progress = progress;
    };

    // Deliberately not awaited: the request returns while this runs.
    void work(report)
      .then((result) => {
        job.status = 'done';
        job.result = result;
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        this.logger.error(`Job ${kind} (${job.id}) failed: ${job.error}`);
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });

    return job;
  }

  get(id: string): EngineJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new NotFoundException(
        'Job not found — the server may have restarted since it began. Run it again.',
      );
    }
    return job;
  }

  list(): EngineJob[] {
    return [...this.jobs.values()].reverse();
  }

  /** For work that must not overlap a different kind of job. */
  assertIdle(kinds: string[]) {
    const busy = kinds.map((k) => this.runningOf(k)).find(Boolean);
    if (busy) throw new ConflictException(`"${busy.kind}" is still running`);
  }

  private runningOf(kind: string): EngineJob | undefined {
    return [...this.jobs.values()].find((j) => j.kind === kind && j.status === 'running');
  }

  private prune() {
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'running');
    for (const job of finished.slice(0, Math.max(0, this.jobs.size - this.KEEP))) {
      this.jobs.delete(job.id);
    }
  }
}
