import { Module } from '@nestjs/common';
import { AuditListener } from './audit.listener';
import { AuditResolver } from './audit.resolver';
import { AuditService } from './audit.service';

@Module({
  providers: [AuditService, AuditListener, AuditResolver],
})
export class AuditModule {}
