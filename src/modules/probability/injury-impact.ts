/**
 * How absences move a match's numbers.
 *
 * The old adjustment multiplied EVERY market by 0.90–0.97 when players were
 * out — Over and Under alike — so complementary markets stopped adding up to
 * 100% and nothing moved in the direction the absence implies. Absences
 * change what a team is expected to score and concede; every goal-based
 * market is then derived from those adjusted expectations, which keeps each
 * Over/Under pair, the 1X2 and BTTS consistent with one another.
 *
 * The per-position weights are deliberately modest priors, not fitted values:
 * the provider does not say whether an absentee is a starter or a squad
 * player, so a long injury list must not swing a market by much. Corners and
 * cards are left alone — there is no good reason an absence moves them.
 */

export interface Absence {
  position: string;
  /** Provider status: 'Out' counts fully, 'Doubtful' half. */
  status: string;
}

/** Share of a team's goals lost per absent player, by position. */
const ATTACK_LOSS: Record<string, number> = { A: 0.05, M: 0.025, D: 0, G: 0 };
/** Share added to the OPPONENT's goals per absent player, by position. */
const DEFENCE_LEAK: Record<string, number> = { G: 0.05, D: 0.03, M: 0.01, A: 0 };
/** However long the list, absences move a team's goals by at most this much each way. */
const CAP = 0.15;

function positionKey(position: string): string | null {
  const p = (position || '').trim().toUpperCase();
  if (p.startsWith('G')) return 'G';
  if (p.startsWith('D')) return 'D';
  if (p.startsWith('M')) return 'M';
  if (p.startsWith('A') || p.startsWith('F')) return 'A';
  return null;
}

function weight(status: string): number {
  const s = (status || '').toLowerCase();
  if (s === 'out') return 1;
  if (s === 'doubtful') return 0.5;
  return 0;
}

function impact(absences: Absence[]): { attackLoss: number; defenceLeak: number } {
  let attackLoss = 0;
  let defenceLeak = 0;
  for (const a of absences) {
    const key = positionKey(a.position);
    if (!key) continue;
    const w = weight(a.status);
    attackLoss += ATTACK_LOSS[key] * w;
    defenceLeak += DEFENCE_LEAK[key] * w;
  }
  return { attackLoss: Math.min(attackLoss, CAP), defenceLeak: Math.min(defenceLeak, CAP) };
}

/**
 * Multipliers on each side's expected goals: its own attackers missing push
 * it down, the opponent's defenders missing push it up.
 */
export function goalMultipliers(
  homeAbsences: Absence[],
  awayAbsences: Absence[],
): { home: number; away: number } {
  const home = impact(homeAbsences);
  const away = impact(awayAbsences);
  return {
    home: (1 - home.attackLoss) * (1 + away.defenceLeak),
    away: (1 - away.attackLoss) * (1 + home.defenceLeak),
  };
}

/** P(X > line) for X ~ Poisson(lambda), line a half-goal like 2.5. */
export function poissonOver(lambda: number, line: number): number {
  const k = Math.floor(line);
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return 1 - cdf;
}

/**
 * Move an observed "over" rate by a multiplier on the expected count.
 *
 * Team markets come from a team's record (how often it scored), not from a
 * fitted average. To scale them consistently with the Poisson markets, find
 * the rate the record implies, scale it, and read the probability back off.
 * The matching Under is 1 minus the result, so the pair still sums to 1.
 */
export function shiftOverProbability(p: number, line: number, multiplier: number): number {
  if (multiplier === 1 || !Number.isFinite(multiplier)) return p;
  const target = Math.min(0.999, Math.max(0.001, p));

  let lo = 1e-6;
  let hi = 50;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (poissonOver(mid, line) < target) lo = mid;
    else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  return Math.min(0.99, Math.max(0.01, poissonOver(lambda * multiplier, line)));
}
