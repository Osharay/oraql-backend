import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Availability, summariseAvailability } from './availability';

export interface FixtureAvailability {
  home: Availability | null;
  away: Availability | null;
}

/**
 * Reads squads, recorded absences and confirmed lineups for a set of fixtures
 * and summarises each side. A side is null when nothing has been checked for
 * it yet — no absence list fetched and no lineup in — so a card says nothing
 * rather than implying a full squad.
 */
@Injectable()
export class AvailabilityReader {
  constructor(private readonly prisma: PrismaService) {}

  async forEvents(
    events: Array<{ id: string; homeTeamId: string; awayTeamId: string; absencesCheckedAt?: Date | null }>,
  ): Promise<Map<string, FixtureAvailability>> {
    const out = new Map<string, FixtureAvailability>();
    if (events.length === 0) return out;

    const teamIds = [...new Set(events.flatMap((e) => [e.homeTeamId, e.awayTeamId]))];
    const eventIds = events.map((e) => e.id);

    const [players, injuries, lineups] = await Promise.all([
      this.prisma.player.findMany({
        where: { teamId: { in: teamIds } },
        select: { id: true, name: true, position: true, seasonGoals: true, seasonAssists: true, teamId: true },
      }),
      this.prisma.playerInjury.findMany({
        where: { player: { teamId: { in: teamIds } } },
        select: { playerId: true, status: true, reason: true, type: true, player: { select: { teamId: true } } },
      }),
      this.prisma.lineup.findMany({
        where: { eventId: { in: eventIds }, isConfirmed: true },
        select: {
          eventId: true,
          teamId: true,
          entries: { where: { isStarter: true }, select: { playerId: true } },
        },
      }),
    ]);

    const squadOf = new Map<string, typeof players>();
    for (const p of players) {
      const list = squadOf.get(p.teamId) ?? [];
      list.push(p);
      squadOf.set(p.teamId, list);
    }
    const absencesOf = new Map<string, Array<{ playerId: string; status: string; reason: string | null }>>();
    for (const i of injuries) {
      const list = absencesOf.get(i.player.teamId) ?? [];
      list.push({ playerId: i.playerId, status: i.status, reason: i.reason ?? i.type ?? null });
      absencesOf.set(i.player.teamId, list);
    }
    const lineupOf = new Map<string, string[]>();
    for (const l of lineups) lineupOf.set(`${l.eventId}::${l.teamId}`, l.entries.map((e) => e.playerId));

    for (const e of events) {
      const side = (teamId: string): Availability | null => {
        const starters = lineupOf.get(`${e.id}::${teamId}`) ?? null;
        // Absences are only this fixture's once they have been checked for it.
        const checked = !!e.absencesCheckedAt || !!starters;
        if (!checked) return null;
        const squad = (squadOf.get(teamId) ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          goals: p.seasonGoals,
          assists: p.seasonAssists,
        }));
        return summariseAvailability(squad, absencesOf.get(teamId) ?? [], starters ? { starters } : null);
      };
      out.set(e.id, { home: side(e.homeTeamId), away: side(e.awayTeamId) });
    }
    return out;
  }
}
