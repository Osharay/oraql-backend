import { Global, Module } from '@nestjs/common';
import { AccountEmailController, MailController } from './mail.controller';
import { MailService } from './mail.service';

@Global()
@Module({
  controllers: [AccountEmailController, MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
