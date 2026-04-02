import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';

/**
 * Cloudflare R2 storage service.
 * Uses S3-compatible API — zero egress fees.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('r2.accountId') || '';
    this.bucket = config.get<string>('r2.bucketName') || 'oracle-assets';
    this.publicUrl = config.get<string>('r2.publicUrl') || '';

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get<string>('r2.accessKeyId') || '',
        secretAccessKey: config.get<string>('r2.secretAccessKey') || '',
      },
    });
  }

  /**
   * Upload a file to R2.
   * Returns the public URL.
   */
  async upload(
    file: Buffer,
    options: {
      folder?: string;
      filename?: string;
      contentType?: string;
    } = {},
  ): Promise<string> {
    const { folder = 'uploads', filename, contentType = 'application/octet-stream' } = options;
    const key = `${folder}/${filename || uuid()}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      }),
    );

    const url = this.publicUrl ? `${this.publicUrl}/${key}` : key;
    this.logger.log(`Uploaded: ${key}`);
    return url;
  }

  /**
   * Download a file from R2.
   */
  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = response.Body;
    if (!stream) {
      throw new Error(`File not found: ${key}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Delete a file from R2.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.log(`Deleted: ${key}`);
  }
}
