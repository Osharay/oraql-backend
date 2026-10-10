import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AdminGuard } from '@/common/guards/admin.guard';
import { Public } from '@/common/decorators/public.decorator';
import { NoPaywall } from '@/common/decorators/no-paywall.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { MailService } from './mail.service';

class EmailDto {
  @IsEmail() @MaxLength(200) email!: string;
}
class TokenDto {
  @IsString() @MinLength(10) @MaxLength(200) token!: string;
}
class ResetDto extends TokenDto {
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) @MaxLength(128) password!: string;
}
class UnsubscribeDto {
  @IsString() @MaxLength(100) u!: string;
  @IsString() @MaxLength(100) s!: string;
}
class CampaignDto {
  @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @IsString() @MinLength(1) @MaxLength(20000) body!: string;
  @IsOptional() @IsString() @MaxLength(60) buttonText?: string;
  @IsOptional() @IsString() @MaxLength(500) buttonUrl?: string;
  @IsIn(['ALL', 'ONE']) audience!: 'ALL' | 'ONE';
  @IsOptional() @IsString() @MaxLength(200) toEmail?: string;
}

/** Password reset and email confirmation, beside sign-in. */
@ApiTags('auth')
@NoPaywall()
@Controller('auth')
export class AccountEmailController {
  constructor(private readonly mail: MailService) {}

  @Post('forgot-password')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Email a password reset link (same answer whether or not the account exists)' })
  forgot(@Body() body: EmailDto) {
    return this.mail.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with the link from the email' })
  reset(@Body() body: ResetDto) {
    return this.mail.resetPassword(body.token, body.password);
  }

  @Post('verify-email')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an email address with the link from the email' })
  verify(@Body() body: TokenDto) {
    return this.mail.verify(body.token);
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the confirm-your-email link again' })
  resend(@CurrentUser('sub') userId: string) {
    return this.mail.resendVerification(userId);
  }
}

/** Newsletters and one-off messages from Engine controls, and unsubscribing. */
@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Post('unsubscribe')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop newsletters for the account in the link (account emails still go)' })
  unsubscribe(@Body() body: UnsubscribeDto) {
    return this.mail.unsubscribe(body.u, body.s);
  }

  @Get('campaigns')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  campaigns(@Query('limit') limit?: string) {
    return this.mail.campaigns(Number(limit) || 30);
  }

  @Get('recipients')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  recipients() {
    return this.mail.recipientCount();
  }

  @Post('campaigns/preview')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(200)
  preview(@Body() body: CampaignDto) {
    return this.mail.preview(body);
  }

  @Post('campaigns/test')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(200)
  test(@CurrentUser('sub') adminId: string, @Body() body: CampaignDto) {
    return this.mail.test(adminId, body);
  }

  @Post('campaigns')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Send a newsletter to everyone, or a message to one user' })
  send(@CurrentUser('sub') adminId: string, @Body() body: CampaignDto) {
    return this.mail.send(adminId, body);
  }
}
