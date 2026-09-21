import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:3000',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}));

/**
 * Where to send a browser after an OAuth round trip. CORS_ORIGINS is a
 * comma-separated list, so using it whole as a URL produced a redirect to
 * "https://a.app,http://localhost:3000/auth/callback". Prefer an explicit
 * FRONTEND_URL and fall back to the first origin in the list.
 */
export const frontendUrl = (): string => {
  const explicit = process.env.FRONTEND_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const first = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',')[0].trim();
  return first.replace(/\/$/, '');
};

/**
 * Provider league ids the daily fixture ingest keeps.
 *
 * Without this the ingest pulled every fixture worldwide, which spread the
 * work far too thin: the team-history sweep is capped at 40 teams a run, so
 * with thousands of clubs in the window almost none ever got history, and the
 * probability engine skipped nearly every event for want of it. Set
 * TRACKED_LEAGUE_IDS to widen or narrow the list; empty means no filter.
 *
 * Defaults to the same six competitions the odds refresh already polls:
 * Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League.
 */
export const trackedLeagueIds = (): string[] => {
  const raw = process.env.TRACKED_LEAGUE_IDS;
  if (raw === '') return [];
  return (raw ?? '39,140,78,135,61,2')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

/**
 * Whether to poll The Odds API. Off unless ODDS_POLLING_ENABLED=true.
 *
 * Nothing consumes the odds yet: market.impliedProbability is never written,
 * so value-bet flags cannot be set, and until picks are publishing there is
 * nothing to attach a price to. Polling meanwhile spent Odds API credits and
 * appended rows to a table nothing read. Turn it back on once the prices feed
 * snapshots (oddsAtCapture) and markets.
 */
export const oddsPollingEnabled = (): boolean =>
  (process.env.ODDS_POLLING_ENABLED ?? '').trim().toLowerCase() === 'true';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'dev-secret-change-me',
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '30d',
}));

export const googleConfig = registerAs('google', () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackUrl: process.env.GOOGLE_CALLBACK_URL,
}));

export const r2Config = registerAs('r2', () => ({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET_NAME || 'oracle-assets',
  publicUrl: process.env.R2_PUBLIC_URL,
}));

export const dataProviderConfig = registerAs('dataProviders', () => ({
  apiFootball: {
    key: process.env.API_FOOTBALL_KEY,
    baseUrl: process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io',
  },
  oddsApi: {
    key: process.env.ODDS_API_KEY,
    baseUrl: process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4',
  },
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
}));
