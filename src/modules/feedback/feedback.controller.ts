import { Body, Controller, Get, Headers, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AdminGuard } from '@/common/guards/admin.guard';
import { Public } from '@/common/decorators/public.decorator';
import { FeedbackService, type Sentiment } from './feedback.service';

class FeedbackDto {
  @IsIn(['POSITIVE', 'NEGATIVE'])
  sentiment!: Sentiment;

  @IsOptional() @IsString() @MaxLength(2000)
  message?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(300)
  page?: string;
}

@ApiTags('feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(201)
  @ApiOperation({ summary: 'Positive or negative feedback, from anyone (signed in or not)' })
  create(@Body() body: FeedbackDto, @Headers('user-agent') ua?: string) {
    return this.feedback.create({ ...body, userAgent: ua ?? null });
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'The latest feedback, for Engine controls' })
  list(@Query('limit') limit?: string) {
    return this.feedback.list(Number(limit) || 100);
  }
}
