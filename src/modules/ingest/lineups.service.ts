import { Injectable, Logger } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';
import { EventsGateway } from '@/modules/events/events.gateway';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { lineupsComplete } from './lineup-state';

export interface LineupCheckResult {
  eventId: string;
  /** Both starting XIs are in and stored. */
  confirmed: boolean;
  /** Absences recorded for the fixture (0 when not confirmed yet). */
  absences: number;
  skipped?: string;
}

/**
 * US-7.2: when lineups are confirmed, store them, record who is missing, and
 * let the caller recompute the match's probabilities.
 *
 * Polled every 10 minutes from 90 minutes before kick-off. Each poll costs one
 * provider request while waiting; on confirmation it costs one more for the
 * fixture's absences, and — only if an absentee's position is unknown — one
 * squad request per side so absences can be weighed by position.
 */
@Injectable()
export class LineupsService {
  private readonly logger = new Logger(LineupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiFootball: ApiFootballAdapter,
    private readonly gateway: EventsGateway,
  ) {}

  async check(eventId: string): Promise<LineupCheckResult> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        externalId: true,
        status: true,
        lineupsConfirmedAt: true,
        homeTeam: { select: { id: true, externalId: true } },
        awayTeam: { select: { id: true, externalId: true } },
      },
    });

    if (!event) return { eventId, confirmed: false, absences: 0, skipped: 'event not found' };
    if (event.lineupsConfirmedAt) {
      return { eventId, confirmed: true, absences: 0, skipped: 'already confirmed' };
    }
    if (event.status !== EventStatus.SCHEDULED) {
      return { eventId, confirmed: false, absences: 0, skipped: `status ${event.status}` };
    }

    const lineups = await this.apiFootball.getLineups(event.externalId);
    if (!lineupsComplete(lineups, event.homeTeam.externalId, event.awayTeam.externalId)) {
      this.logger.debug(`Lineups not out yet for event ${eventId}`);
      return { eventId, confirmed: false, absences: 0 };
    }

    const teamIdByExternal = new Map([
      [event.homeTeam.externalId, event.homeTeam.id],
      [event.awayTeam.externalId, event.awayTeam.id],
    ]);

    for (const lineup of lineups) {
      const teamId = teamIdByExternal.get(lineup.teamExternalId);
      if (!teamId) continue;

      const people = [
        ...lineup.starters.map((p) => ({ ...p, isStarter: true })),
        ...lineup.substitutes.map((p) => ({ ...p, gridPosition: undefined, isStarter: false })),
      ];

      // Players the ingest has never seen are created from the lineup itself.
      const playerIdByExternal = new Map<string, string>();
      for (const p of people) {
        const player = await this.prisma.player.upsert({
          where: { externalId: p.playerExternalId },
          create: {
            externalId: p.playerExternalId,
            name: p.name || `Player ${p.playerExternalId}`,
            position: p.position,
            number: p.number,
            teamId,
          },
          // Keep the club current (transfers) and fill a missing position.
          update: {
            teamId,
            ...(p.name ? { name: p.name } : {}),
            ...(p.position ? { position: p.position } : {}),
            ...(p.number != null ? { number: p.number } : {}),
          },
          select: { id: true },
        });
        playerIdByExternal.set(p.playerExternalId, player.id);
      }

      await this.prisma.$transaction(async (tx) => {
        const stored = await tx.lineup.upsert({
          where: { eventId_teamId: { eventId, teamId } },
          create: { eventId, teamId, formation: lineup.formation, isConfirmed: true },
          update: { formation: lineup.formation, isConfirmed: true },
          select: { id: true },
        });
        await tx.lineupEntry.deleteMany({ where: { lineupId: stored.id } });
        await tx.lineupEntry.createMany({
          data: people.map((p) => ({
            lineupId: stored.id,
            playerId: playerIdByExternal.get(p.playerExternalId)!,
            position: p.position,
            gridPosition: p.gridPosition,
            isStarter: p.isStarter,
          })),
          skipDuplicates: true,
        });
      });
    }

    const absences = await this.recordAbsences(event.externalId, teamIdByExternal);

    await this.prisma.event.update({
      where: { id: eventId },
      data: { lineupsConfirmedAt: new Date(), status: EventStatus.LINEUP_CONFIRMED },
    });
    this.gateway.broadcastEventStatus(eventId, EventStatus.LINEUP_CONFIRMED);

    this.logger.log(`Lineups confirmed for event ${eventId} (${absences} absences recorded)`);
    return { eventId, confirmed: true, absences };
  }

  /**
   * Replace each side's recorded absences with this fixture's.
   *
   * The injuries table used to be written by nothing, so the probability
   * engine never saw an absence. Replacing rather than appending keeps it to
   * who is missing now — last month's knock does not linger.
   */
  private async recordAbsences(
    fixtureExternalId: string,
    teamIdByExternal: Map<string, string>,
  ): Promise<number> {
    let injuries;
    try {
      injuries = await this.apiFootball.getFixtureInjuries(fixtureExternalId);
    } catch (error) {
      // Lineups are still worth confirming without absences.
      this.logger.warn(
        `Absences unavailable for fixture ${fixtureExternalId}: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }

    const relevant = injuries.filter((i) => teamIdByExternal.has(i.teamExternalId));

    // Absentees are not in the lineup, so their position may be unknown. The
    // position is what decides how much an absence matters; fetch the squad
    // for a side only when one of its absentees needs it.
    const known = await this.prisma.player.findMany({
      where: { externalId: { in: relevant.map((i) => i.playerExternalId) } },
      select: { externalId: true, position: true },
    });
    const positionKnown = new Set(known.filter((p) => p.position).map((p) => p.externalId));
    const squadNeeded = new Set(
      relevant.filter((i) => !positionKnown.has(i.playerExternalId)).map((i) => i.teamExternalId),
    );

    for (const teamExternalId of squadNeeded) {
      const teamId = teamIdByExternal.get(teamExternalId)!;
      try {
        const squad = await this.apiFootball.getPlayers(teamExternalId, new Date().getFullYear());
        for (const p of squad) {
          await this.prisma.player.upsert({
            where: { externalId: p.externalId },
            create: {
              externalId: p.externalId,
              name: p.name,
              position: p.position,
              number: p.number,
              photoUrl: p.photoUrl,
              teamId,
            },
            update: { teamId, ...(p.position ? { position: p.position } : {}) },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Squad unavailable for team ${teamExternalId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    let recorded = 0;
    for (const [teamExternalId, teamId] of teamIdByExternal) {
      const forTeam = relevant.filter((i) => i.teamExternalId === teamExternalId);

      const rows = [];
      for (const i of forTeam) {
        const player = await this.prisma.player.upsert({
          where: { externalId: i.playerExternalId },
          create: {
            externalId: i.playerExternalId,
            name: i.playerName || `Player ${i.playerExternalId}`,
            teamId,
          },
          update: {},
          select: { id: true },
        });
        rows.push({ playerId: player.id, type: i.type, reason: i.reason, status: i.status });
      }

      await this.prisma.$transaction([
        this.prisma.playerInjury.deleteMany({ where: { player: { teamId } } }),
        this.prisma.playerInjury.createMany({ data: rows }),
      ]);
      recorded += rows.length;
    }

    return recorded;
  }
}
