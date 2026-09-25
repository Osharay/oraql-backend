import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  validate(payload: JwtPayload) {
    // Only access tokens open the API. Refresh tokens are signed with another
    // key and would not get this far, but the type is checked regardless.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Access token required');
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }
}
