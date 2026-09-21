import { summariseForm, compareForm, chanceBand, MarketForm } from './form-summary';

const seq = (s: string) => [...s].map((c) => (c === 'W' ? 'WIN' : 'LOSS')) as Array<'WIN' | 'LOSS'>;

describe('summariseForm', () => {
  it('reads the recent window from the newest results', () => {
    // newest first: 5 wins, then 10 losses
    const f = summariseForm(seq('WWWWWLLLLLLLLLL'), 10, 0.5);
    expect(f.recent).toBe('WWWWWLLLLL');
    expect(f.recentWins).toBe(5);
    expect(f.recentPlayed).toBe(10);
    expect(f.recentRate).toBeCloseTo(0.5);
  });

  it('keeps the longer record beside it', () => {
    const f = summariseForm(seq('WWWWWLLLLLLLLLL'), 10, 0.5);
    expect(f.longWins).toBe(5);
    expect(f.longPlayed).toBe(15);
    expect(f.longRate).toBeCloseTo(1 / 3);
  });

  it('counts the current run from the latest match only', () => {
    expect(summariseForm(seq('WWWLWW'), 10, 0.5).currentRun).toBe(3);
    expect(summariseForm(seq('LWWWWW'), 10, 0.5).currentRun).toBe(0);
  });

  it('measures lift against the market, not against 50%', () => {
    const f = summariseForm(seq('WWWWWWWWLL'), 10, 0.85);
    expect(f.lift).toBeCloseTo(-0.05);
  });

  // The client's point about windows, with the maths he did not say out loud:
  // five for five on a 60% market is common luck; nine of ten on a 48% one is not.
  it('calls a short perfect run on a likely market common', () => {
    const f = summariseForm(seq('WWWWW'), 10, 0.6);
    expect(f.chance).toBeCloseTo(0.6 ** 5, 5);
    expect(f.chanceBand).toBe('common');
  });

  it('calls nine of ten on a coin-flip market rare', () => {
    const f = summariseForm(seq('WWWWLWWWWW'), 10, 0.48);
    expect(f.chanceBand).toBe('rare');
  });

  it('gives no chance figure without a baseline rather than inventing one', () => {
    const f = summariseForm(seq('WWWW'), 10, null);
    expect(f.chance).toBeNull();
    expect(f.lift).toBeNull();
  });

  it('handles fewer results than the window', () => {
    const f = summariseForm(seq('WLW'), 10, 0.5);
    expect(f.recentPlayed).toBe(3);
    expect(f.recent).toBe('WLW');
  });
});

describe('chanceBand', () => {
  it('bands by probability of luck', () => {
    expect(chanceBand(0.001)).toBe('rare');
    expect(chanceBand(0.03)).toBe('unusual');
    expect(chanceBand(0.2)).toBe('common');
  });
});

describe('compareForm', () => {
  const f = (over: Partial<MarketForm>): MarketForm => ({
    recent: '',
    recentWins: 0,
    recentPlayed: 10,
    recentRate: 0.5,
    currentRun: 0,
    longWins: 0,
    longPlayed: 0,
    longRate: 0,
    baselineRate: 0.5,
    lift: 0,
    chance: null,
    chanceBand: null,
    ...over,
  });

  // Ranked by raw rate, "Under 4.5 goals, 10/10" tops every team. It lands for
  // everyone. Lift puts the unusual market first — the one the client wants
  // Oracle to find for him.
  it('ranks an unusual market above a merely common one by default', () => {
    const common = f({ recentRate: 1.0, baselineRate: 0.95, lift: 0.05 });
    const unusual = f({ recentRate: 0.8, baselineRate: 0.45, lift: 0.35 });
    expect([common, unusual].sort(compareForm('lift'))[0]).toBe(unusual);
  });

  it('can rank by raw rate when asked', () => {
    const common = f({ recentRate: 1.0, lift: 0.05 });
    const unusual = f({ recentRate: 0.8, lift: 0.35 });
    expect([unusual, common].sort(compareForm('rate'))[0]).toBe(common);
  });

  it('can rank by current run', () => {
    const long = f({ currentRun: 7, lift: 0.1 });
    const short = f({ currentRun: 2, lift: 0.3 });
    expect([short, long].sort(compareForm('run'))[0]).toBe(long);
  });

  it('puts markets with no baseline after ones that have one', () => {
    const none = f({ lift: null });
    const some = f({ lift: -0.1 });
    expect([none, some].sort(compareForm('lift'))[0]).toBe(some);
  });
});
