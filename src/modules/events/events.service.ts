import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Sport, EventStatus, Prisma } from '@prisma/client';
import { EventFilterDto } from './dto/event-filter.dto';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get events for a given date with filters.
   * Core dashboard query — optimized with indexes.
   */
  async findByDate(filters: EventFilterDto) {
    const {
      date,
      sport = Sport.FOOTBALL,
      leagueIds,
      status,
      page = 1,
      limit = 50,
    } = filters;

    // Build date range for the target day
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Prisma.EventWhereInput = {
      sport,
      kickoffAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      ...(leagueIds?.length && { leagueId: { in: leagueIds } }),
      ...(status && { status }),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: {
          league: {
            select: { id: true, name: true, country: true, logoUrl: true },
          },
          homeTeam: {
            select: { id: true, name: true, shortName: true, logoUrl: true },
          },
          awayTeam: {
            select: { id: true, name: true, shortName: true, logoUrl: true },
          },
          picks: {
            where: { isActive: true },
            orderBy: { rank: 'asc' },
            take: 3,
            select: {
              id: true,
              rank: true,
              probability: true,
              market: {
                select: { name: true, shortName: true, category: true },
              },
            },
          },
        },
        orderBy: { kickoffAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: events,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get event detail with full market data, lineups, and picks.
   */
  async findById(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        league: {
          select: { id: true, name: true, country: true, logoUrl: true, season: true },
        },
        homeTeam: {
          select: { id: true, name: true, shortName: true, logoUrl: true, venueName: true },
        },
        awayTeam: {
          select: { id: true, name: true, shortName: true, logoUrl: true },
        },
        markets: {
          orderBy: [{ category: 'asc' }, { probability: 'desc' }],
          select: {
            id: true,
            category: true,
            name: true,
            shortName: true,
            line: true,
            probability: true,
            confidence: true,
            impliedProbability: true,
            valueGap: true,
            isValueBet: true,
            explanation: true,
            explanationFactors: true,
            probabilityUpdatedAt: true,
          },
        },
        picks: {
          where: { isActive: true },
          orderBy: { rank: 'asc' },
          include: {
            market: {
              select: {
                id: true,
                category: true,
                name: true,
                shortName: true,
                probability: true,
                isValueBet: true,
              },
            },
          },
        },
        lineups: {
          include: {
            entries: {
              include: {
                player: {
                  select: {
                    id: true,
                    name: true,
                    position: true,
                    number: true,
                    photoUrl: true,
                  },
                },
              },
              orderBy: { isStarter: 'desc' },
            },
          },
        },
        matchStats: {
          include: {
            team: {
              select: { id: true, name: true, shortName: true },
            },
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    return event;
  }

  /**
   * Get upcoming events across all sports (next 24h).
   * Used for the "What's Coming Up" section.
   */
  async findUpcoming(sport?: Sport, limit = 20) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return this.prisma.event.findMany({
      where: {
        kickoffAt: { gte: now, lte: tomorrow },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
        ...(sport && { sport }),
      },
      include: {
        league: { select: { name: true, logoUrl: true } },
        homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
      },
      orderBy: { kickoffAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Get live events.
   */
  async findLive(sport?: Sport) {
    return this.prisma.event.findMany({
      where: {
        status: { in: [EventStatus.LIVE, EventStatus.HALF_TIME] },
        ...(sport && { sport }),
      },
      include: {
        league: { select: { name: true, logoUrl: true } },
        homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
      },
      orderBy: { kickoffAt: 'asc' },
    });
  }

  /**
   * Get sport-level summary (event count per sport for today).
   */
  async getSportSummary(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const counts = await this.prisma.event.groupBy({
      by: ['sport'],
      where: {
        kickoffAt: { gte: startOfDay, lte: endOfDay },
      },
      _count: { id: true },
    });

    return counts.map((c) => ({
      sport: c.sport,
      eventCount: c._count.id,
    }));
  }

  /**
   * Get available leagues for a sport on a given date.
   */
  async getLeaguesForDate(sport: Sport, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const leagues = await this.prisma.league.findMany({
      where: {
        sport,
        events: {
          some: {
            kickoffAt: { gte: startOfDay, lte: endOfDay },
          },
        },
      },
      select: {
        id: true,
        name: true,
        country: true,
        logoUrl: true,
        _count: {
          select: {
            events: {
              where: {
                kickoffAt: { gte: startOfDay, lte: endOfDay },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return leagues.map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      logoUrl: l.logoUrl,
      eventCount: l._count.events,
    }));
  }
}
