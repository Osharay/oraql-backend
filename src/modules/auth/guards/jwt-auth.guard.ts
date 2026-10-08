import { Injectable, ExecutionContext, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { NO_PAYWALL_KEY } from '@/common/decorators/no-paywall.decorator';
import { BillingService } from '@/modules/billing/billing.service';

/**
 * Signed in, and — unless the route is marked @NoPaywall — within the free
 * trial or a paid period. A lapsed account gets 402 with a code the website
 * turns into the Subscribe page. Admins and comp accounts always pass.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    @Optional() private readonly billing?: BillingService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const signedIn = (await super.canActivate(context)) as boolean;
    if (!signedIn || !this.billing) return signedIn;
    if (this.reflector.getAllAndOverride<boolean>(NO_PAYWALL_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest()?.user as { sub?: string; role?: string } | undefined;
    if (!user?.sub || user.role === 'ADMIN' || user.role === 'PREMIUM') return true;
    if (await this.billing.allowed(user.sub)) return true;

    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your free trial has ended. Subscribe to keep using OraQL.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
