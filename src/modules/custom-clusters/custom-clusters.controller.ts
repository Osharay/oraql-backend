import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CustomClustersService } from './custom-clusters.service';

class SaveClusterDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

@ApiTags('custom-clusters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-clusters')
export class CustomClustersController {
  constructor(private readonly clusters: CustomClustersService) {}

  @Post()
  @ApiOperation({ summary: 'Save the current Bet Builder as a cluster, locked before kickoff' })
  save(@CurrentUser('sub') userId: string, @Body() body: SaveClusterDto) {
    return this.clusters.save(userId, body?.name);
  }

  @Get()
  @ApiOperation({ summary: "The user's saved clusters and how each landed" })
  list(@CurrentUser('sub') userId: string) {
    return this.clusters.list(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a saved cluster before its first match starts' })
  remove(@CurrentUser('sub') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.clusters.remove(userId, id);
  }
}
