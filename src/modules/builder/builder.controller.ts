import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BuilderService } from './builder.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('builder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('builder')
export class BuilderController {
  constructor(private readonly builderService: BuilderService) {}

  @Get()
  @ApiOperation({ summary: 'Get current Bet Builder selections' })
  async getSelections(@CurrentUser('sub') userId: string) {
    return this.builderService.getSelections(userId);
  }

  @Post('add/:marketId')
  @ApiOperation({ summary: 'Add a market to the Bet Builder' })
  async addSelection(
    @CurrentUser('sub') userId: string,
    @Param('marketId', ParseUUIDPipe) marketId: string,
  ) {
    return this.builderService.addSelection(userId, marketId);
  }

  @Delete('remove/:marketId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a market from the Bet Builder' })
  async removeSelection(
    @CurrentUser('sub') userId: string,
    @Param('marketId', ParseUUIDPipe) marketId: string,
  ) {
    return this.builderService.removeSelection(userId, marketId);
  }

  @Delete('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all Bet Builder selections' })
  async clearSelections(@CurrentUser('sub') userId: string) {
    return this.builderService.clearSelections(userId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export Bet Builder selections as formatted text' })
  async exportSelections(@CurrentUser('sub') userId: string) {
    return this.builderService.exportSelections(userId);
  }
}
