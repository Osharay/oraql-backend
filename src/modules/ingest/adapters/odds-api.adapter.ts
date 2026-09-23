import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OddsData } from '../interfaces/data-provider.interface';

/**
 * The Odds API adapter — dedicated odds aggregation.
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 */
@Injectable()
export class OddsApiAdapter {
  readonly name = 'odds_api';
  private readonly logger = new Logger(OddsApiAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('dataProviders.oddsApi.baseUrl')!;
    this.apiKey = config.get<string>('dataProviders.oddsApi.key') || '';
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    url.searchParams.set('apiKey', this.apiKey);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    if (!this.apiKey) {
      throw new Error('Odds API request failed: ODDS_API_KEY is not set on this deployment');
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      // The status alone hid what was wrong: half-hourly "401" logs for days
      // never said whether the key was rejected, expired or out of credits.
      // The provider answers with a message; quote it.
      const body = await response.text().catch(() => '');
      const message = body.slice(0, 300).replace(/\s+/g, ' ').trim();
      throw new Error(
        `Odds API request failed: ${response.status}` +
          (message ? ` — ${message}` : '') +
          (response.status === 401
            ? ' (401 is authentication: the key is rejected, not out of credits)'
            : ''),
      );
    }

    // Track remaining credits
    const remaining = response.headers.get('x-requests-remaining');
    if (remaining) {
      this.logger.debug(`Odds API credits remaining: ${remaining}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check the key without spending anything.
   *
   * /v4/sports is free — it does not consume a credit — so this answers "is
   * the key good, and what is left" without touching the quota. Never returns
   * the key itself, only its shape, which is enough to spot the usual causes:
   * an empty variable, or quotes and whitespace pasted in with it.
   */
  async diagnose(): Promise<{
    ok: boolean;
    status: number | null;
    detail: string;
    keyPresent: boolean;
    keyLength: number;
    keyLooksPadded: boolean;
    creditsRemaining: string | null;
    creditsUsed: string | null;
    sports: number | null;
  }> {
    const shape = {
      keyPresent: Boolean(this.apiKey),
      keyLength: this.apiKey.length,
      keyLooksPadded: this.apiKey !== this.apiKey.trim() || /^["']|["']$/.test(this.apiKey),
    };

    if (!this.apiKey) {
      return {
        ...shape,
        ok: false,
        status: null,
        detail: 'ODDS_API_KEY is not set on this deployment.',
        creditsRemaining: null,
        creditsUsed: null,
        sports: null,
      };
    }

    const url = new URL(`${this.baseUrl}/sports`);
    url.searchParams.set('apiKey', this.apiKey);

    try {
      const response = await fetch(url.toString());
      const body = await response.text().catch(() => '');

      let sports: number | null = null;
      if (response.ok) {
        try {
          const parsed = JSON.parse(body) as unknown[];
          sports = Array.isArray(parsed) ? parsed.length : null;
        } catch {
          sports = null;
        }
      }

      return {
        ...shape,
        ok: response.ok,
        status: response.status,
        detail: response.ok
          ? `Key accepted. ${sports ?? 0} sports listed. This check is free and spends no credits.`
          : `${response.status}: ${body.slice(0, 300).replace(/\s+/g, ' ').trim()}` +
            (response.status === 401
              ? ' — 401 means the key itself was rejected (wrong, expired, or revoked), not that credits ran out.'
              : response.status === 429
                ? ' — 429 means the monthly credit allowance is used up.'
                : ''),
        creditsRemaining: response.headers.get('x-requests-remaining'),
        creditsUsed: response.headers.get('x-requests-used'),
        sports,
      };
    } catch (error) {
      return {
        ...shape,
        ok: false,
        status: null,
        detail: `Could not reach the Odds API: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
        creditsRemaining: null,
        creditsUsed: null,
        sports: null,
      };
    }
  }

  /**
   * Get odds for a sport (e.g., "soccer_epl").
   * Maps The Odds API sport keys to our internal format.
   */
  async getOddsForSport(
    sportKey: string,
    regions = 'uk',
    markets = 'h2h,totals,spreads',
  ): Promise<OddsData[]> {
    // The Odds API charges one credit per market per region per call, so both
    // of these arguments multiply the bill. Defaults are deliberately narrow.
    const raw = await this.request<any[]>(`sports/${sportKey}/odds`, {
      regions,
      markets,
      oddsFormat: 'decimal',
    });

    const odds: OddsData[] = [];

    for (const event of raw) {
      for (const bookmaker of event.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            odds.push({
              fixtureExternalId: event.id, // Odds API event ID — not an API-Football id
              bookmaker: bookmaker.key,
              marketName: this.mapMarketName(market.key),
              selection: outcome.name,
              odds: outcome.price,
              homeTeamName: event.home_team,
              awayTeamName: event.away_team,
              commenceAt: event.commence_time ? new Date(event.commence_time) : undefined,
            });
          }
        }
      }
    }

    return odds;
  }

  /**
   * Get available sports from The Odds API.
   */
  async getSports(): Promise<Array<{ key: string; title: string; active: boolean }>> {
    return this.request<any[]>('sports', { all: 'false' });
  }

  private mapMarketName(key: string): string {
    const map: Record<string, string> = {
      h2h: 'Match Result',
      totals: 'Over/Under Goals',
      spreads: 'Asian Handicap',
    };
    return map[key] || key;
  }
}
