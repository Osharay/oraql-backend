import {
  IsOptional,
  IsEnum,
  IsString,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Sport, EventStatus } from '@prisma/client';

export class EventFilterDto {
  @ApiPropertyOptional({ description: 'ISO date string (YYYY-MM-DD). Defaults to today.' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ enum: Sport, default: Sport.FOOTBALL })
  @IsOptional()
  @IsEnum(Sport)
  sport?: Sport;

  @ApiPropertyOptional({ description: 'Filter by league IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leagueIds?: string[];

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
