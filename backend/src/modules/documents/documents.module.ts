import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { DocumentsUploadController } from './documents-upload.controller';
import { DocumentsResolver } from './documents.resolver';
import { DocumentsService } from './documents.service';

@Module({
  imports: [IngestionModule],
  controllers: [DocumentsUploadController],
  providers: [DocumentsService, DocumentsResolver],
  exports: [DocumentsService],
})
export class DocumentsModule {}
