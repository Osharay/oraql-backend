import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min, Matches } from 'class-validator';

export const SELECTION_SOURCES = ['STREAK_EVIDENCE', 'STREAK_EMERGING', 'STREAK_EXPLORATORY', 'CLUSTER', 'MATCH_FORM'] as const;
export type SelectionSource = (typeof SELECTION_SOURCES)[number];

export class AddStreakSelectionDto {
  @IsUUID()
  eventId!: string;

  /** A market definition id from the streak registry, e.g. TEAM_UNDER_1_5. */
  @IsString()
  @Matches(/^[A-Z0-9_]{2,64}$/)
  marketId!: string;

  /** The team the streak is about; omitted for match-wide markets. */
  @IsOptional()
  @IsUUID()
  teamId?: string;

  /** The streak's chance (recent form or record), 0–1. Clamped server-side. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  probability?: number;

  /** Where it was added from, shown on a saved cluster. */
  @IsOptional()
  @IsIn(SELECTION_SOURCES)
  source?: SelectionSource;
}
