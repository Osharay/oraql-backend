import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { tokenMatches } from './token-hash';
import { UsersService } from '@/modules/users/users.service';
import { RegisterDto } from './dto/register.dto';
import { AuthProvider } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Which kind of token this is. Only 'access' is accepted by the API. */
  typ: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Register a new user with email/password.
   */
  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      authProvider: AuthProvider.EMAIL,
      preferredSports: dto.preferredSports,
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);

    this.logger.log(`User registered: ${user.email}`);
    return tokens;
  }

  /**
   * Validate email/password login.
   */
  async validateLocal(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  /**
   * Login: return token pair.
   */
  async login(userId: string, email: string, role: string): Promise<TokenPair> {
    const tokens = await this.generateTokens(userId, email, role);
    await this.usersService.updateRefreshToken(userId, tokens.refreshToken);
    return tokens;
  }

  /**
   * Handle Google OAuth callback.
   */
  async handleGoogleAuth(profile: {
    email: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    providerId: string;
  }): Promise<TokenPair> {
    let user = await this.usersService.findByEmail(profile.email);

    if (!user) {
      user = await this.usersService.create({
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        authProvider: AuthProvider.GOOGLE,
        providerId: profile.providerId,
        emailVerified: true,
      });
      this.logger.log(`Google user created: ${profile.email}`);
    }

    return this.login(user.id, user.email, user.role);
  }

  /**
   * Refresh the access token using a valid refresh token.
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    // The user comes from the verified token and nowhere else. There is no
    // fallback: an unverifiable token is simply refused.
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    // Must be the one most recently issued: each refresh rotates it, so a
    // token that was already used (or stolen and used) no longer matches.
    if (!tokenMatches(refreshToken, user.refreshToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  /**
   * Logout: clear refresh token.
   */
  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshToken(userId, null);
  }

  /**
   * Generate JWT access + refresh token pair.
   */
  private async generateTokens(
    userId: string,
    email: string,
    role: string,
  ): Promise<TokenPair> {
    const claims = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...claims, typ: 'access' } satisfies JwtPayload, {
        expiresIn: this.config.get<string>('jwt.accessExpiration', '15m'),
      }),
      // Own key, own type, and a unique id so two refreshes in the same second
      // never produce the same token.
      this.jwtService.signAsync({ ...claims, typ: 'refresh' } satisfies JwtPayload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiration', '30d'),
        jwtid: randomUUID(),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
