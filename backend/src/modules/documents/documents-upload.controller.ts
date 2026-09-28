import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/auth.decorators';
import { UploadDocumentDto } from './documents.models';
import { DocumentsService } from './documents.service';
import { MAX_UPLOAD_BYTES } from './text-extraction';

/** Multipart upload stays REST: GraphQL multipart is a CSRF foot-gun and Apollo blocks it by default. */
@Controller('documents')
export class DocumentsUploadController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload')
  @Roles('editor')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: UploadDocumentDto) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    return this.documents.createFromUpload(file, body);
  }
}
