import { Module } from '@nestjs/common';
import { BuilderModule } from '@/modules/builder/builder.module';
import { CustomClustersController } from './custom-clusters.controller';
import { CustomClustersService } from './custom-clusters.service';

@Module({
  imports: [BuilderModule],
  controllers: [CustomClustersController],
  providers: [CustomClustersService],
})
export class CustomClustersModule {}
