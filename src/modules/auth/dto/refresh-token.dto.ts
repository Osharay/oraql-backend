import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;

  /**
   * Optional. The refresh token already carries the user in its `sub` claim,
   * so the server reads it from there; a client that cannot supply a userId
   * (it is not part of the login response) can refresh without one.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;
}
