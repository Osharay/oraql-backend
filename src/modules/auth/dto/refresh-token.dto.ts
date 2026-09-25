import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;

  // No userId. It used to be accepted as a fallback when the token did not
  // verify, which let anyone name the account they wanted a session for. The
  // user comes from the verified token and nowhere else.
}
