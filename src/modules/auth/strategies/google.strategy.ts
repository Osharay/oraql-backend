import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('google.clientId') || 'placeholder',
      clientSecret: config.get<string>('google.clientSecret') || 'placeholder',
      callbackURL: config.get<string>('google.callbackUrl'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const user = {
      email: profile.emails?.[0]?.value || '',
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      avatarUrl: profile.photos?.[0]?.value,
      providerId: profile.id,
    };
    done(null, user);
  }
}
