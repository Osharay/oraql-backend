/**
 * Coerce a query-string value to a finite number, falling back when it isn't one.
 *
 * The global ValidationPipe runs with `enableImplicitConversion: true`, which
 * turns an absent numeric @Query() param into NaN rather than leaving it
 * undefined. NaN then slips past JS default parameters and reaches Prisma,
 * which rejects it ("Argument `gte` is missing"). Always route optional numeric
 * query params through this.
 */
export function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
