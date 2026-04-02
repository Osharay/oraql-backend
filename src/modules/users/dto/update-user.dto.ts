import { IsString, IsOptional, IsArray, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Sport } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'Europe/London' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: ['FOOTBALL', 'BASKETBALL'], enum: Sport, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Sport, { each: true })
  preferredSports?: Sport[];
}
