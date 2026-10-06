/**
 * Whether a competition is between national teams.
 *
 * International football behaves differently from club football — teams meet
 * a few times a year, squads change between windows, friendlies sit beside
 * qualifiers — so a record means less, and the client asked to see it apart.
 *
 * The provider files every international competition under country "World",
 * but so are the club ones (Champions League, Libertadores), so the name
 * decides. Club competitions are named first so "Club Friendlies" and "AFC
 * Champions League" never read as national-team football.
 */
const CLUB_WORDS = /\b(clubs?|champions league|europa|conference league|libertadores|sudamericana|cup winners|super cup|recopa|leagues cup)\b/i;
const NATIONAL_WORDS =
  /\b(world cup|nations league|euro championship|uefa euro|africa cup of nations|afcon|copa america|gold cup|asian cup|friendlies|qualification|qualifiers?|olympic|u17|u19|u20|u21|u23|cosafa|cafa|saff|aff|asean|gulf cup|arab cup|cecafa|wafu)\b/i;

export function isInternationalCompetition(name: string | null | undefined, country?: string | null): boolean {
  const n = name ?? '';
  if (CLUB_WORDS.test(n)) return false;
  if (NATIONAL_WORDS.test(n)) return (country ?? 'World') === 'World' || /friendlies|qualif/i.test(n);
  return false;
}
