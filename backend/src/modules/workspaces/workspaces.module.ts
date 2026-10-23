import { Module } from '@nestjs/common';
import { WorkspacesResolver } from './workspaces.resolver';
import { WorkspacesService } from './workspaces.service';

@Module({
  providers: [WorkspacesService, WorkspacesResolver],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
