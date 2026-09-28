import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';
import { coveredLeagueFilter } from '@/common/covered-leagues';
import { ProbabilityService } from '@/modules/probability/probability.service';
import { ApiFootballAdapter, ApiFootballQuotaExhausted } from './adapters/api-football.adapter';
import type { PlayerSeasonStat } from './interfaces/data-provider.interface';
import { LineupsService } from './lineups.service';

/**
 * Keeps who-is-missing current for the fixtures coming up, days ahead of the
 * lineups.
 *
 * Twice a day, for covered fixtures in the next three days:
 *  - each club's season numbers per player (who scores its goals), at most
 *    every three days per club — about two requests a club;
 *  - each fixture's injuries and suspensions, at most every twelve hours —
 *    one request a fixture;
 * then recomputes the fixture's probabilities so the absences are in them.
 *
 * Everything degrades quietly: a club the provider has no numbers for still
 * gets its absences listed (marked of unknown weight), a failed request skips
 * that club or fixture, and an exhausted daily allowance ends the run.
 */
@Injectable()
export class AvailabilityRefreshService {
  private readonly logger = new Logger(AvailabilityRefreshService.name);

  private readonly WINDOW_HOURS = 72;
  private readonly STATS_MAX_AGE_MS = 3 * 86_400_000;
  private readonly ABSENCES_MAX_AGE_MS = 12 * 3_600_000;
  /** Below this much goal involvement, early-season numbers are topped up with last season's. */
  private readonly THIN_SEASON = 8;
  /** A run stops asking the provider after this many requests. */
  private readonly REQUEST_BUDGET = 600;

  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiFootball: ApiFootballAdapter,
    private readonly lineups: LineupsService,
    private readonly probability: ProbabilityService,
  ) {}

  @Cron('20 6,14 * * *', { name: 'availability-refresh', timeZone: 'UTC' })
  async scheduled() {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.error(`Availability refresh failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async refresh(
    options: { windowHours?: number; onProgress?: (p: Record<string, unknown>) => void } = {},
  ): Promise<{ fixtures: number; clubsUpdated: number; fixturesChecked: number; requests: number; stoppedEarly?: string }> {
    if (this.running) return { fixtures: 0, clubsUpdated: 0, fixturesChecked: 0, requests: 0, stoppedEarly: 'already running' };
    this.running = true;
    try {
      return await this.run(options);
    } finally {
      this.running = false;
    }
  }

  private async run(options: { windowHours?: number; onProgress?: (p: Record<string, unknown>) => void }) {
    const now = new Date();
    const covered = await coveredLeagueFilter(this.prisma);
    const events = await this.prisma.event.findMany({
      where: {
        kickoffAt: { gt: now, lte: new Date(now.getTime() + (options.windowHours ?? this.WINDOW_HOURS) * 3_600_000) },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
        ...(covered && { league: covered }),
      },
      orderBy: { kickoffAt: 'asc' },
      select: {
        id: true,
        externalId: true,
        season: true,
        absencesCheckedAt: true,
        league: { select: { season: true } },
        homeTeam: { select: { id: true, externalId: true, playerStatsAt: true } },
        awayTeam: { select: { id: true, externalId: true, playerStatsAt: true } },
      },
    });

    let requests = 0;
    let clubsUpdated = 0;
    let fixturesChecked = 0;
    let stoppedEarly: string | undefined;
    const report = () =>
      options.onProgress?.({ fixtures: events.length, 'clubs updated': clubsUpdated, 'fixtures checked': fixturesChecked, requests });

    // Clubs first: absences are weighed by these numbers.
    const clubs = new Map<string, { id: string; externalId: string; season: number }>();
    for (const e of events) {
      const season = e.season ?? e.league.season;
      for (const t of [e.homeTeam, e.awayTeam]) {
        const fresh = t.playerStatsAt && now.getTime() - t.playerStatsAt.getTime() < this.STATS_MAX_AGE_MS;
        if (!fresh && !clubs.has(t.id)) clubs.set(t.id, { id: t.id, externalId: t.externalId, season });
      }
    }

    try {
      for (const club of clubs.values()) {
        if (requests >= this.REQUEST_BUDGET) {
          stoppedEarly = 'request budget reached';
          break;
        }
        try {
          let stats = await this.apiFootball.getPlayerSeasonStats(club.externalId, club.season);
          requests += Math.max(1, Math.ceil(stats.length / 20));
          const involvement = stats.reduce((n, p) => n + p.goals + 0.5 * p.assists, 0);
          if (involvement < this.THIN_SEASON) {
            // Early season: last season's numbers say more about who matters.
            const previous = await this.apiFootball.getPlayerSeasonStats(club.externalId, club.season - 1);
            requests += Math.max(1, Math.ceil(previous.length / 20));
            stats = mergeSeasons(stats, previous);
          }
          await this.storeClubStats(club.id, club.season, stats);
          clubsUpdated++;
        } catch (error) {
          if (error instanceof ApiFootballQuotaExhausted) throw error;
          this.logger.warn(`Player numbers unavailable for club ${club.externalId}: ${error instanceof Error ? error.message : error}`);
        }
        report();
      }

      for (const e of events) {
        if (requests >= this.REQUEST_BUDGET) {
          stoppedEarly = 'request budget reached';
          break;
        }
        const fresh = e.absencesCheckedAt && now.getTime() - e.absencesCheckedAt.getTime() < this.ABSENCES_MAX_AGE_MS;
        if (fresh) continue;
        try {
          await this.lineups.recordAbsences(
            e.externalId,
            new Map([
              [e.homeTeam.externalId, e.homeTeam.id],
              [e.awayTeam.externalId, e.awayTeam.id],
            ]),
          );
          requests += 1;
          await this.prisma.event.update({ where: { id: e.id }, data: { absencesCheckedAt: new Date() } });
          // The absences now weigh on the fixture's probabilities too.
          await this.probability.computeForEvent(e.id).catch((error) =>
            this.logger.warn(`Recompute after absences failed for ${e.id}: ${error instanceof Error ? error.message : error}`),
          );
          fixturesChecked++;
        } catch (error) {
          if (error instanceof ApiFootballQuotaExhausted) throw error;
          this.logger.warn(`Absences unavailable for fixture ${e.externalId}: ${error instanceof Error ? error.message : error}`);
        }
        report();
      }
    } catch (error) {
      if (!(error instanceof ApiFootballQuotaExhausted)) throw error;
      stoppedEarly = 'API-Football daily allowance used up';
    }

    this.logger.log(
      `Availability: ${events.length} fixtures, ${clubsUpdated} clubs updated, ${fixturesChecked} fixtures checked, ~${requests} requests` +
        (stoppedEarly ? ` (stopped: ${stoppedEarly})` : ''),
    );
    return { fixtures: events.length, clubsUpdated, fixturesChecked, requests, ...(stoppedEarly ? { stoppedEarly } : {}) };
  }

  /**
   * Store each player's numbers for this club, and clear the numbers of
   * players no longer in its list (sold, released), so they stop counting
   * towards the squad.
   */
  private async storeClubStats(teamId: string, season: number, stats: PlayerSeasonStat[]) {
    const now = new Date();
    for (const p of stats) {
      const numbers = {
        seasonGoals: p.goals,
        seasonAssists: p.assists,
        seasonApps: p.appearances,
        seasonMinutes: p.minutes,
        seasonShots: p.shots,
        statsSeason: season,
        statsAt: now,
      };
      await this.prisma.player.upsert({
        where: { externalId: p.externalId },
        create: {
          externalId: p.externalId,
          name: p.name,
          position: p.position,
          photoUrl: p.photoUrl,
          teamId,
          ...numbers,
        },
        update: { teamId, ...(p.position ? { position: p.position } : {}), ...numbers },
      });
    }
    await this.prisma.player.updateMany({
      where: { teamId, externalId: { notIn: stats.map((p) => p.externalId) }, statsAt: { not: null } },
      data: { seasonGoals: null, seasonAssists: null, seasonApps: null, seasonMinutes: null, seasonShots: null, statsAt: null },
    });
    await this.prisma.team.update({ where: { id: teamId }, data: { playerStatsAt: now } });
  }
}

/**
 * Add last season's numbers to this season's, for players still at the club.
 * A player who has left is not in this season's list, so he adds nothing.
 */
export function mergeSeasons(current: PlayerSeasonStat[], previous: PlayerSeasonStat[]): PlayerSeasonStat[] {
  const prev = new Map(previous.map((p) => [p.externalId, p]));
  return current.map((p) => {
    const q = prev.get(p.externalId);
    if (!q) return p;
    return {
      ...p,
      appearances: p.appearances + q.appearances,
      minutes: p.minutes + q.minutes,
      goals: p.goals + q.goals,
      assists: p.assists + q.assists,
      shots: p.shots + q.shots,
    };
  });
}
