import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import {
  ObservationResult,
  ObservationSelection,
  Prisma,
  StreakEntityType,
  StreakStatus,
} from '@prisma/client';
import {
  binomialUpperTail,
  benjaminiHochberg,
  streakLengths,
} from './stats.util';

type Venue = 'ALL' | 'HOME' | 'AWAY';

interface SliceRow {
  result: 'WIN' | 'LOSS';
  isHome: boolean | null;
  leagueId: string;
  season: number;
  qualityOk: boolean;
}

interface TestedCandidate {
  entityType: StreakEntityType;
  entityId: string;
  marketDefinitionId: string;
  selection: ObservationSelection;
  context: Prisma.InputJsonValue;
  sampleSize: number;
  wins: number;
  hitRate: number;
  baselineRate: number;
  lift: number;
  pValue: number;
  currentStreak: number;
  longestStreak: number;
  last10: string;
  qualityShare: number;
}

/**
 * Candidate generation and gating.
 *
 * Two questions, kept strictly apart: is this slice distinguishable from its
 * market's baseline (a statistical gate), and — among those that are — which
 * deserve the limited room on the feed (a ranking). Scoring anything that
 * failed the gate is how noise reaches a user wearing a confidence badge.
 */
@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  /**
   * Nothing below this is eligible, however good it looks.
   *
   * Set from a power analysis, not by taste: to clear a BH gate over ~1,000
   * tests, an 18-point edge over a 0.50 baseline needs roughly 90 observations.
   * A 10-match window cannot support a statistical claim at any search width,
   * so the old "last 5-10 matches" framing is display detail, never evidence.
   */
  private readonly MIN_SAMPLE = 50;

  /** False discovery rate for the Benjamini–Hochberg gate. */
  private readonly ALPHA = 0.1;

  /**
   * Contexts tested per market. Every extra context multiplies the number of
   * tests AND divides the sample, which pushes the gate out of reach twice
   * over — a venue split halves n while doubling m. Default is the whole
   * record; venue slices are opt-in and only worth it with deep history.
   */
  private readonly DEFAULT_CONTEXTS: Venue[] = ['ALL'];

  /** Observations to consider per team — roughly three seasons. */
  private readonly LOOKBACK = 600;

  /** Lift that earns full marks on the lift component of the score. */
  private readonly LIFT_FULL_MARKS = 0.3;

  constructor(private readonly prisma: PrismaService) {}

  async runEngine(options?: {
    contexts?: Venue[];
    minSample?: number;
  }): Promise<{
    engineRunId: string;
    tested: number;
    surviving: number;
    minSample: number;
    gateThreshold: number;
    note: string;
  }> {
    const contexts = options?.contexts ?? this.DEFAULT_CONTEXTS;
    const minSample = options?.minSample ?? this.MIN_SAMPLE;
    const run = await this.prisma.engineRun.create({ data: {} });

    try {
      const [definitions, baselines, teams] = await Promise.all([
        this.prisma.marketDefinition.findMany({
          where: { isActive: true },
          select: { id: true, marketId: true, selections: true },
        }),
        this.prisma.marketBaseline.findMany({
          select: {
            marketDefinitionId: true,
            leagueId: true,
            season: true,
            baselineRate: true,
          },
        }),
        this.prisma.team.findMany({ select: { id: true } }),
      ]);

      const baselineMap = new Map<string, number>();
      for (const b of baselines) {
        baselineMap.set(
          `${b.marketDefinitionId}::${b.leagueId ?? 'GLOBAL'}::${b.season ?? 'GLOBAL'}`,
          b.baselineRate,
        );
      }

      const tested: TestedCandidate[] = [];
      let eventsSeen = 0;

      for (const team of teams) {
        const rowsByKey = await this.loadTeamSlices(team.id);
        eventsSeen += rowsByKey.size;

        for (const [key, rows] of rowsByKey) {
          const [marketDefinitionId, selection] = key.split('::');

          for (const venue of contexts) {
            const subset =
              venue === 'ALL'
                ? rows
                : rows.filter((r) => r.isHome === (venue === 'HOME'));

            const candidate = this.testSlice(
              team.id,
              marketDefinitionId,
              selection as ObservationSelection,
              venue,
              subset,
              baselineMap,
              minSample,
            );
            if (candidate) tested.push(candidate);
          }
        }
      }

      // Correct across every test performed in this run — not just the
      // promising ones. Using the survivors as the denominator would defeat it.
      const adjusted = benjaminiHochberg(tested.map((c) => c.pValue));

      let surviving = 0;
      const toWrite: Prisma.StreakCandidateCreateManyInput[] = tested.map((c, i) => {
        const adjustedPValue = adjusted[i];
        const survivedGate = adjustedPValue <= this.ALPHA && c.lift > 0;
        if (survivedGate) surviving++;

        return {
          engineRunId: run.id,
          entityType: c.entityType,
          entityId: c.entityId,
          marketDefinitionId: c.marketDefinitionId,
          selection: c.selection,
          context: c.context,
          sampleSize: c.sampleSize,
          wins: c.wins,
          hitRate: c.hitRate,
          baselineRate: c.baselineRate,
          lift: c.lift,
          pValue: c.pValue,
          adjustedPValue,
          currentStreak: c.currentStreak,
          longestStreak: c.longestStreak,
          last10: c.last10,
          strengthScore: survivedGate ? this.strengthScore(c) : 0,
          status: survivedGate ? StreakStatus.ACTIVE : StreakStatus.FILTERED,
          survivedGate,
        };
      });

      if (toWrite.length > 0) {
        await this.prisma.streakCandidate.createMany({ data: toWrite });
      }

      await this.prisma.engineRun.update({
        where: { id: run.id },
        data: {
          completedAt: new Date(),
          eventsScanned: eventsSeen,
          candidatesTested: tested.length,
          candidatesSurviving: surviving,
        },
      });

      // The bar a candidate had to clear, for diagnostics. With m tests the
      // first discovery needs p <= alpha/m, which is why search width matters
      // as much as the evidence itself.
      const gateThreshold = tested.length > 0 ? this.ALPHA / tested.length : 0;

      const note =
        surviving === 0 && tested.length > 0
          ? `No slice was distinguishable from its baseline. With ${tested.length} tests the first discovery must beat p=${gateThreshold.toExponential(2)}; deeper history or a narrower search is what moves this, not a lower threshold.`
          : `${surviving} of ${tested.length} slices cleared the gate.`;

      this.logger.log(`Engine run ${run.id}: ${note}`);

      return {
        engineRunId: run.id,
        tested: tested.length,
        surviving,
        minSample,
        gateThreshold,
        note,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.engineRun.update({
        where: { id: run.id },
        data: { completedAt: new Date(), errors: message },
      });
      throw error;
    }
  }

  /**
   * Observations for a team, keyed by market and selection.
   *
   * MATCH-selection rows carry no teamId — they belong to the fixture, not a
   * side — so they are reached through the event and attributed to whichever
   * team we are slicing for.
   */
  private async loadTeamSlices(teamId: string): Promise<Map<string, SliceRow[]>> {
    const observations = await this.prisma.marketObservation.findMany({
      where: {
        result: { in: [ObservationResult.WIN, ObservationResult.LOSS] },
        OR: [
          { teamId },
          {
            selection: ObservationSelection.MATCH,
            event: { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
          },
        ],
      },
      select: {
        marketDefinitionId: true,
        selection: true,
        result: true,
        isHome: true,
        leagueId: true,
        season: true,
        dataQuality: true,
        event: { select: { homeTeamId: true } },
      },
      orderBy: { kickoffAt: 'desc' },
      take: this.LOOKBACK,
    });

    const byKey = new Map<string, SliceRow[]>();

    for (const o of observations) {
      const key = `${o.marketDefinitionId}::${o.selection}`;
      const isHome =
        o.selection === ObservationSelection.MATCH
          ? o.event.homeTeamId === teamId
          : o.isHome;

      const list = byKey.get(key) ?? [];
      list.push({
        result: o.result as 'WIN' | 'LOSS',
        isHome,
        leagueId: o.leagueId,
        season: o.season,
        qualityOk: o.dataQuality === 'OK',
      });
      byKey.set(key, list);
    }

    return byKey;
  }

  private testSlice(
    teamId: string,
    marketDefinitionId: string,
    selection: ObservationSelection,
    venue: Venue,
    rows: SliceRow[],
    baselineMap: Map<string, number>,
    minSample: number,
  ): TestedCandidate | null {
    if (rows.length < minSample) return null;

    const wins = rows.filter((r) => r.result === 'WIN').length;
    const hitRate = wins / rows.length;

    // Prefer the league-and-season baseline for this slice; fall back to the
    // market's global rate. With neither, the slice cannot be judged at all.
    const modal = this.modalLeagueSeason(rows);
    const baselineRate =
      baselineMap.get(`${marketDefinitionId}::${modal.leagueId}::${modal.season}`) ??
      baselineMap.get(`${marketDefinitionId}::GLOBAL::GLOBAL`);

    if (baselineRate == null) return null;

    const results = rows.map((r) => r.result);
    const { current, longest } = streakLengths(results);

    return {
      entityType: StreakEntityType.TEAM,
      entityId: teamId,
      marketDefinitionId,
      selection,
      context: { venue },
      sampleSize: rows.length,
      wins,
      hitRate,
      baselineRate,
      lift: hitRate - baselineRate,
      pValue: binomialUpperTail(wins, rows.length, baselineRate),
      currentStreak: current,
      longestStreak: longest,
      last10: results
        .slice(0, 10)
        .map((r) => (r === 'WIN' ? 'W' : 'L'))
        .join(''),
      qualityShare: rows.filter((r) => r.qualityOk).length / rows.length,
    };
  }

  private modalLeagueSeason(rows: SliceRow[]) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.leagueId}::${r.season}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let bestKey = '';
    let best = -1;
    for (const [k, n] of counts) {
      if (n > best) {
        best = n;
        bestKey = k;
      }
    }
    const [leagueId, season] = bestKey.split('::');
    return { leagueId, season };
  }

  /**
   * Ranking among survivors only.
   *
   * Current streak carries the least weight on purpose: it is the most
   * eye-catching number and the least informative one. A run of six is what a
   * 60% market does roughly one time in twenty.
   *
   * The odds/edge component is skipped while observations carry no odds, and
   * its weight is redistributed rather than scored as zero.
   */
  private strengthScore(c: TestedCandidate): number {
    const components: Array<{ weight: number; value: number }> = [
      { weight: 0.35, value: Math.min(Math.max(c.lift, 0) / this.LIFT_FULL_MARKS, 1) },
      { weight: 0.2, value: Math.min(c.sampleSize / 40, 1) },
      { weight: 0.1, value: this.last10Rate(c.last10) },
      { weight: 0.05, value: Math.min(c.currentStreak / 8, 1) },
      { weight: 0.05, value: c.qualityShare },
    ];

    // Edge vs implied odds (0.25) is unavailable: rescale what remains to 1.
    const totalWeight = components.reduce((s, x) => s + x.weight, 0);
    const score = components.reduce((s, x) => s + x.weight * x.value, 0) / totalWeight;

    return Math.round(score * 1000) / 1000;
  }

  private last10Rate(last10: string): number {
    if (!last10.length) return 0;
    return [...last10].filter((c) => c === 'W').length / last10.length;
  }

  /** Survivors of the most recent completed run, strongest first. */
  async getLatestSurvivors(limit = 50) {
    const run = await this.prisma.engineRun.findFirst({
      where: { completedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, candidatesTested: true, candidatesSurviving: true },
    });

    if (!run) return { run: null, candidates: [] };

    const candidates = await this.prisma.streakCandidate.findMany({
      where: { engineRunId: run.id, survivedGate: true },
      include: {
        marketDefinition: { select: { marketId: true, displayName: true, shortName: true } },
      },
      orderBy: { strengthScore: 'desc' },
      take: limit,
    });

    return { run, candidates };
  }
}
