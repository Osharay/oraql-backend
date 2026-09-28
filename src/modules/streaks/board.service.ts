import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { coveredLeagueFilter } from '@/common/covered-leagues';
import { EventStatus } from '@prisma/client';
import { MARKET_DEFINITIONS, marketScope } from './market-definitions';
import { streakMarketLabel, marketSubjectOf } from '@/common/market-copy';
import { FormService, type TeamMarketForm } from './form.service';
import { AvailabilityReader } from '@/modules/availability/availability.reader';
import { absenceVerdict, type Availability } from '@/modules/availability/availability';
import {
  BoardSort,
  EVIDENCE_FLOOR,
  meetsFloor,
  CONFIDENCE_NOTE,
  combineSides,
  compareBoard,
  confidenceOf,
  agreementOf,
  type Agreement,
  type Confidence,
  type SideEvidence,
} from './market-board';

export interface BoardRowOut {
  marketId: string;
  marketLabel: string;
  category: string;
  scope: 'TEAM' | 'MATCH';
  /** Which side of the fixture the row is about. */
  side: 'HOME' | 'AWAY' | 'MATCH';
  subject: string;
  probability: number;
  baselineRate: number | null;
  edge: number | null;
  wins: number;
  played: number;
  confidence: Confidence;
  confidenceNote: string;
  /** Newest first, e.g. "WWLWW" — the last few results behind the estimate. */
  recent: string;
  currentRun: number;
  evidence: SideEvidence[];
  /** True when the gated engine also found this slice significant here. */
  gated: boolean;
  /** Whether both sides' records lean the same way on this market. */
  agreement: Agreement | null;
  /** Key players missing, and whether that works against this row or for it. */
  absence: { effect: 'HURTS' | 'HELPS'; level: 'MAJOR' | 'MINOR' } | null;
}

/**
 * Every market, for one fixture.
 *
 * The streak engine is deliberately strict, and on most days nothing clears
 * it — which left the product with nothing to show. This is the other half of
 * the client's ask: take the fixtures we hold, take the history behind both
 * teams, and state what each of the 70 markets looks like for THIS match,
 * with the evidence and its weakness on the row.
 *
 * Team markets are read on the side that plays them: the home team's home
 * record, the away team's away record. Match-wide markets are read across
 * both teams' matches at those venues and averaged, weighted by how much each
 * has played. Every rate is shrunk towards the market's usual rate, so a 5
 * from 5 does not present itself as a certainty, and a market with no history
 * shows the market's own rate and says it has nothing behind it.
 *
 * None of this is a price or a recommendation. It is the record, per market.
 */
@Injectable()
export class BoardService {
  private readonly logger = new Logger(BoardService.name);

  /** The form window used for the results strip on each row. */
  private readonly STRIP = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly form: FormService,
    private readonly availability: AvailabilityReader,
  ) {}

  async forEvent(eventId: string, options: { sort?: BoardSort; limit?: number } = {}) {
    const sort: BoardSort = options.sort ?? 'probability';

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        kickoffAt: true,
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        absencesCheckedAt: true,
        homeTeam: { select: { id: true, name: true, shortName: true } },
        awayTeam: { select: { id: true, name: true, shortName: true } },
        league: { select: { name: true, country: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Both sides, each measured where they play this fixture. minPlayed 0:
    // the board shows every market it has any record for, marked for what it
    // is, rather than quietly dropping the thin ones.
    const [home, away] = await Promise.all([
      this.form.teamForm(event.homeTeamId, { window: this.STRIP, venue: 'HOME', minPlayed: 0 }),
      this.form.teamForm(event.awayTeamId, { window: this.STRIP, venue: 'AWAY', minPlayed: 0 }),
    ]);

    const homeName = event.homeTeam.shortName || event.homeTeam.name;
    const awayName = event.awayTeam.shortName || event.awayTeam.name;

    const byMarket = (rows: TeamMarketForm[]) => new Map(rows.map((m) => [m.marketId, m]));
    const homeRows = byMarket(home.markets);
    const awayRows = byMarket(away.markets);

    const gated = await this.gatedSlices(eventId);

    // Who is missing on each side. Never fails the board.
    const sides = await this.availability
      .forEvents([event])
      .then((m) => m.get(event.id) ?? { home: null, away: null })
      .catch(() => ({ home: null as Availability | null, away: null as Availability | null }));

    // What each side lets opponents do where it plays this fixture: the other
    // half of a team market. Northampton scoring under 1.5 away is also York
    // keeping home opponents under 1.5.
    const [homeAllows, awayAllows] = await Promise.all([
      this.opponentRecord(event.homeTeamId, 'HOME'),
      this.opponentRecord(event.awayTeamId, 'AWAY'),
    ]);

    const rows: BoardRowOut[] = [];

    for (const def of MARKET_DEFINITIONS) {
      const scope = marketScope(def.marketId);
      const h = homeRows.get(def.marketId);
      const a = awayRows.get(def.marketId);
      const baseline = h?.baselineRate ?? a?.baselineRate ?? null;
      const category = h?.category ?? a?.category ?? 'OTHER';

      if (scope === 'TEAM') {
        // One row per club: only one team can win to nil, and the board has
        // to say which team each row is about.
        for (const [side, name, teamId, row, oppName, allows] of [
          ['HOME', homeName, event.homeTeamId, h, awayName, awayAllows.get(def.marketId)],
          ['AWAY', awayName, event.awayTeamId, a, homeName, homeAllows.get(def.marketId)],
        ] as const) {
          const own = {
            label: `${name} ${side === 'HOME' ? 'at home' : 'away'}`,
            wins: row?.longWins ?? 0,
            played: row?.longPlayed ?? 0,
          };
          const against = {
            label: `${oppName}'s ${side === 'HOME' ? 'away' : 'home'} opponents`,
            wins: allows?.wins ?? 0,
            played: allows?.played ?? 0,
          };
          const evidenceSides = against.played > 0 ? [own, against] : [own];
          const combined = combineSides(evidenceSides, baseline);
          const wins = combined.wins;
          const played = combined.played;
          const probability = combined.probability;

          rows.push({
            marketId: def.marketId,
            marketLabel: streakMarketLabel(def.displayName, scope, name),
            category,
            scope,
            side,
            subject:
              side === 'HOME'
                ? `${name} at home — not the match total`
                : `${name} away — not the match total`,
            probability,
            baselineRate: baseline,
            edge: baseline == null ? null : probability - baseline,
            wins,
            played,
            confidence: confidenceOf(played),
            confidenceNote: CONFIDENCE_NOTE[confidenceOf(played)],
            recent: row?.recent ?? '',
            currentRun: row?.currentRun ?? 0,
            evidence: evidenceSides,
            gated: gated.has(`${def.marketId}::${teamId}`),
            agreement: agreementOf([own, against], baseline),
            absence:
              side === 'HOME'
                ? absenceVerdict(def.marketId, sides.home, sides.away)
                : absenceVerdict(def.marketId, sides.away, sides.home),
          });
        }
        continue;
      }

      // Match-wide: both teams' matches at the venue they play this one at.
      const evidence: SideEvidence[] = [
        { label: `${homeName} at home`, wins: h?.longWins ?? 0, played: h?.longPlayed ?? 0 },
        { label: `${awayName} away`, wins: a?.longWins ?? 0, played: a?.longPlayed ?? 0 },
      ];
      const combined = combineSides(evidence, baseline);

      rows.push({
        marketId: def.marketId,
        marketLabel: streakMarketLabel(def.displayName, scope),
        category,
        scope,
        side: 'MATCH',
        subject: marketSubjectOf(scope).label,
        probability: combined.probability,
        baselineRate: baseline,
        edge: baseline == null ? null : combined.probability - baseline,
        wins: combined.wins,
        played: combined.played,
        confidence: confidenceOf(combined.played),
        confidenceNote: CONFIDENCE_NOTE[confidenceOf(combined.played)],
        // The strip belongs to one team's matches; the home side's is the one
        // a reader is looking at when the fixture is listed home-first.
        recent: h?.recent ?? a?.recent ?? '',
        currentRun: h?.currentRun ?? 0,
        evidence,
        gated:
          gated.has(`${def.marketId}::${event.homeTeamId}`) ||
          gated.has(`${def.marketId}::${event.awayTeamId}`),
        agreement: agreementOf(evidence, baseline),
        absence: absenceVerdict(def.marketId, sides.home, sides.away),
      });
    }

    rows.sort(compareBoard(sort));

    const measured = rows.filter((r) => meetsFloor(r.played)).length;
    const someHistory = rows.filter((r) => r.played > 0).length;
    const limit = Math.min(options.limit ?? rows.length, rows.length);

    return {
      event: {
        id: event.id,
        kickoffAt: event.kickoffAt,
        status: event.status,
        league: event.league,
        home: { id: event.homeTeam.id, name: homeName },
        away: { id: event.awayTeam.id, name: awayName },
      },
      availability: sides,
      sort,
      markets: rows.length,
      measured,
      someHistory,
      evidenceFloor: EVIDENCE_FLOOR,
      lookbackDays: home.lookbackDays,
      caveat:
        `${measured} of ${rows.length} markets have enough history to measure for this fixture ` +
        `(at least ${EVIDENCE_FLOOR} settled matches each; ${someHistory - measured} more have some, but too little). ` +
        'Every rate is pulled towards the market’s usual rate in proportion to how little is behind it, ' +
        'so a short perfect run reads as a lean, not a certainty. These are records, not prices: ' +
        'a high number is only worth acting on if the odds are longer than it.',
      rows: rows.slice(0, limit),
    };
  }

  /**
   * How a team's opponents have done in each team market, at the venue the
   * team plays this fixture — what it concedes, in effect. Two years, the
   * same window as the team's own record.
   */
  private async opponentRecord(
    teamId: string,
    venue: 'HOME' | 'AWAY',
  ): Promise<Map<string, { wins: number; played: number }>> {
    const since = new Date(Date.now() - 730 * 86_400_000);
    const rows =
      venue === 'HOME'
        ? await this.prisma.$queryRaw<Array<{ marketId: string; wins: bigint | number; played: bigint | number }>>`
            SELECT md."marketId", COUNT(*) FILTER (WHERE o.result = 'WIN') AS wins, COUNT(*) AS played
            FROM events e
            JOIN market_observations o ON o."eventId" = e.id AND o."teamId" = e."awayTeamId"
            JOIN market_definitions md ON md.id = o."marketDefinitionId"
            WHERE e."homeTeamId" = ${teamId}
              AND e.status = 'FINISHED'
              AND e."kickoffAt" >= ${since}
              AND o.result IN ('WIN', 'LOSS')
            GROUP BY md."marketId"`
        : await this.prisma.$queryRaw<Array<{ marketId: string; wins: bigint | number; played: bigint | number }>>`
            SELECT md."marketId", COUNT(*) FILTER (WHERE o.result = 'WIN') AS wins, COUNT(*) AS played
            FROM events e
            JOIN market_observations o ON o."eventId" = e.id AND o."teamId" = e."homeTeamId"
            JOIN market_definitions md ON md.id = o."marketDefinitionId"
            WHERE e."awayTeamId" = ${teamId}
              AND e.status = 'FINISHED'
              AND e."kickoffAt" >= ${since}
              AND o.result IN ('WIN', 'LOSS')
            GROUP BY md."marketId"`;
    return new Map(rows.map((r) => [r.marketId, { wins: Number(r.wins), played: Number(r.played) }]));
  }

  /**
   * Which market/team slices the gated engine also found significant for this
   * fixture — the badge on the board, so the strict findings stay visible
   * among everything else rather than being buried by it.
   */
  private async gatedSlices(eventId: string): Promise<Set<string>> {
    const snapshots = await this.prisma.streakSnapshot.findMany({
      where: { eventId, streakCandidate: { survivedGate: true } },
      select: {
        streakCandidate: {
          select: { entityId: true, marketDefinition: { select: { marketId: true } } },
        },
      },
    });

    return new Set(
      snapshots.map(
        (s) => `${s.streakCandidate.marketDefinition.marketId}::${s.streakCandidate.entityId}`,
      ),
    );
  }

  /**
   * The strongest rows across every fixture in a window — the day's board.
   *
   * Built from the per-fixture boards so a row means exactly the same thing
   * in both places.
   */
  async forDate(options: { date?: string; hours?: number; perFixture?: number; sort?: BoardSort } = {}) {
    const hours = options.hours ?? 48;
    const perFixture = options.perFixture ?? 3;
    const from = options.date ? new Date(options.date) : new Date();
    const to = new Date(from.getTime() + hours * 3600_000);

    const covered = await coveredLeagueFilter(this.prisma);
    const events = await this.prisma.event.findMany({
      where: {
        kickoffAt: { gte: from, lte: to },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
        ...(covered && { league: covered }),
      },
      orderBy: { kickoffAt: 'asc' },
      select: { id: true },
      take: 60,
    });

    const boards = [];
    for (const e of events) {
      const board = await this.forEvent(e.id, { sort: options.sort, limit: perFixture });
      if (board.measured > 0) boards.push(board);
    }

    this.logger.log(`Board: ${boards.length} fixtures with measurable markets in the next ${hours}h`);

    return { from, to, fixtures: boards.length, boards };
  }
}
