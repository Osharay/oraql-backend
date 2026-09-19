import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';

/**
 * Admin check against the database, not the token.
 *
 * Roles are baked into the JWT at sign time, so a promotion does not reach an
 * already-issued token: the UI reads /users/me and shows ADMIN while the API
 * still sees USER and returns 403. Reading the current role here means a role
 * change takes effect immediately, and a revoked one does too — which matters
 * more, since these endpoints spend API quota.
 *
 * One extra query per admin request, and admin requests are rare.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      throw new ForbiddenException('Admin role required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
