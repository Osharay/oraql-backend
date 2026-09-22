import { EngineJobsService } from './engine-jobs.service';

const tick = () => new Promise((r) => setImmediate(r));

describe('EngineJobsService', () => {
  it('returns at once and records the result when the work finishes', async () => {
    const jobs = new EngineJobsService();
    let finish!: (v: unknown) => void;
    const job = jobs.start('derive', () => new Promise((r) => (finish = r)));

    expect(job.status).toBe('running');
    finish({ events: 3 });
    await tick();

    expect(jobs.get(job.id).status).toBe('done');
    expect(jobs.get(job.id).result).toEqual({ events: 3 });
    expect(jobs.get(job.id).finishedAt).not.toBeNull();
  });

  it('hands a second click the running job instead of starting another', () => {
    const jobs = new EngineJobsService();
    let calls = 0;
    const work = () => {
      calls++;
      return new Promise(() => undefined);
    };
    const a = jobs.start('derive', work);
    const b = jobs.start('derive', work);

    expect(b.id).toBe(a.id);
    expect(calls).toBe(1);
  });

  it('lets different kinds run side by side', () => {
    const jobs = new EngineJobsService();
    const never = () => new Promise(() => undefined);
    expect(jobs.start('derive', never).id).not.toBe(jobs.start('engine', never).id);
  });

  it('records a failure with its message', async () => {
    const jobs = new EngineJobsService();
    const job = jobs.start('engine', async () => {
      throw new Error('No space left on device');
    });
    await tick();

    expect(jobs.get(job.id).status).toBe('failed');
    expect(jobs.get(job.id).error).toBe('No space left on device');
  });

  it('keeps progress reported along the way', async () => {
    const jobs = new EngineJobsService();
    let finish!: () => void;
    const job = jobs.start('derive', (report) => {
      report({ events: 500 });
      return new Promise<void>((r) => (finish = r));
    });

    expect(jobs.get(job.id).progress).toEqual({ events: 500 });
    finish();
    await tick();
  });

  it('allows a new run once the last one has finished', async () => {
    const jobs = new EngineJobsService();
    const a = jobs.start('derive', async () => 1);
    await tick();
    const b = jobs.start('derive', async () => 2);
    expect(b.id).not.toBe(a.id);
  });

  it('refuses work that would overlap a named running job', () => {
    const jobs = new EngineJobsService();
    jobs.start('derive', () => new Promise(() => undefined));
    expect(() => jobs.assertIdle(['derive'])).toThrow(/still running/);
  });
});
