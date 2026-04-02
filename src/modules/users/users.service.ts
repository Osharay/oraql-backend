import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { AuthProvider, Sport, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    email: string;
    passwordHash?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    authProvider: AuthProvider;
    providerId?: string;
    emailVerified?: boolean;
    preferredSports?: Sport[];
  }) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
        authProvider: data.authProvider,
        providerId: data.providerId,
        emailVerified: data.emailVerified ?? false,
        preferredSports: data.preferredSports ?? [Sport.FOOTBALL],
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        authProvider: true,
        emailVerified: true,
        preferredSports: true,
        timezone: true,
        refreshToken: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        preferredSports: true,
        timezone: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        timezone: dto.timezone,
        preferredSports: dto.preferredSports,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        preferredSports: true,
        timezone: true,
        updatedAt: true,
      },
    });
  }

  async updateRefreshToken(id: string, refreshToken: string | null) {
    const hashed = refreshToken
      ? await bcrypt.hash(refreshToken, 10)
      : null;

    return this.prisma.user.update({
      where: { id },
      data: { refreshToken: hashed },
    });
  }

  async logActivity(userId: string, action: string, metadata?: Record<string, unknown>) {
    return this.prisma.userActivityLog.create({
      data: { userId, action, metadata: metadata as Prisma.JsonObject },
    });
  }
}
