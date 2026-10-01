import { IsNumber, IsOptional, IsString, IsUUID, Max, Min, Matches } from 'class-validator';

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
}
