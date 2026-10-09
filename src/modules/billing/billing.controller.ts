import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AdminGuard } from '@/common/guards/admin.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { NoPaywall } from '@/common/decorators/no-paywall.decorator';
import { BillingService } from './billing.service';
import { bachsSignatureOk, flutterwaveSignatureOk, type PlanId, type ProviderId } from './billing-rules';

class CheckoutDto {
  @IsIn(['MONTHLY', 'QUARTERLY'])
  plan!: PlanId;

  @IsIn(['FLUTTERWAVE', 'BACHS'])
  provider!: ProviderId;
}

class ConfirmDto {
  @IsString()
  reference!: string;
}

class SettingsDto {
  @IsOptional() @IsInt() @Min(100) monthlyPrice?: number;
  @IsOptional() @IsInt() @Min(100) quarterlyPrice?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) trialDays?: number;
  @IsOptional() @IsBoolean() paywallEnabled?: boolean;
}

/**
 * Bachs's docs name the headers X-Bachs-Signature(-V2) and X-Bachs-Timestamp;
 * its portal says Bachs-Signature. Both are read. A value in the
 * `t=…,v1=…` form is the V2 layout whichever name it arrives under.
 */
export function bachsHeaders(h: Record<string, string | undefined>) {
  const v2 = h['x-bachs-signature-v2'] ?? h['bachs-signature-v2'];
  const v1 = h['x-bachs-signature'] ?? h['bachs-signature'];
  const timestamp = h['x-bachs-timestamp'] ?? h['bachs-timestamp'];
  if (v2) return { signatureV2: v2, signature: v1, timestamp };
  if (v1 && v1.includes('v1=')) return { signatureV2: v1, timestamp };
  return { signature: v1, timestamp };
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @NoPaywall()
  @ApiOperation({ summary: 'Trial or subscription state, the plans and the payment options' })
  status(@CurrentUser('sub') userId: string) {
    return this.billing.status(userId);
  }

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @NoPaywall()
  @ApiOperation({ summary: "Start paying: returns the provider's checkout page" })
  checkout(@CurrentUser('sub') userId: string, @Body() body: CheckoutDto) {
    return this.billing.checkout(userId, body.plan, body.provider);
  }

  @Post('confirm')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @NoPaywall()
  @HttpCode(200)
  @ApiOperation({ summary: 'After the provider sends the user back: check the payment and give access' })
  confirm(@CurrentUser('sub') userId: string, @Body() body: ConfirmDto) {
    return this.billing.confirm(body.reference, userId);
  }

  @Get('settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  settings() {
    return this.billing.settings();
  }

  @Put('settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Change prices, the trial length or switch the paywall' })
  updateSettings(@Body() body: SettingsDto) {
    return this.billing.updateSettings(body);
  }

  @Get('payments')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  payments(@Query('limit') limit?: string) {
    return this.billing.recentPayments(Number(limit) || 50);
  }

  /** Flutterwave → us. Checked against the secret hash, then re-verified with the API. */
  @Post('webhooks/flutterwave')
  @Public()
  @HttpCode(200)
  flutterwave(@Headers('verif-hash') hash: string | undefined, @Body() body: unknown) {
    if (!flutterwaveSignatureOk(hash, process.env.FLUTTERWAVE_WEBHOOK_HASH)) throw new UnauthorizedException();
    return this.billing.onFlutterwaveEvent(body as never);
  }

  /** Bachs → us. HMAC over the raw body; rejected if stale or unsigned. */
  @Post('webhooks/bachs')
  @Public()
  @HttpCode(200)
  bachs(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string | undefined>) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('No body');
    const ok = bachsSignatureOk(
      bachsHeaders(headers),
      raw,
      process.env.BACHS_WEBHOOK_SECRET,
      new Date(),
    );
    if (!ok) throw new UnauthorizedException();
    return this.billing.onBachsEvent(JSON.parse(raw.toString('utf8')));
  }
}
