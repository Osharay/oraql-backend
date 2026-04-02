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

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Odds API request failed: ${response.status}`);
    }

    // Track remaining credits
    const remaining = response.headers.get('x-requests-remaining');
    if (remaining) {
      this.logger.debug(`Odds API credits remaining: ${remaining}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get odds for a sport (e.g., "soccer_epl").
   * Maps The Odds API sport keys to our internal format.
   */
  async getOddsForSport(sportKey: string, regions = 'uk,eu'): Promise<OddsData[]> {
    const raw = await this.request<any[]>(`sports/${sportKey}/odds`, {
      regions,
      markets: 'h2h,totals,spreads',
      oddsFormat: 'decimal',
    });

    const odds: OddsData[] = [];

    for (const event of raw) {
      for (const bookmaker of event.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            odds.push({
              fixtureExternalId: event.id, // Odds API event ID
              bookmaker: bookmaker.key,
              marketName: this.mapMarketName(market.key),
              selection: outcome.name,
              odds: outcome.price,
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
