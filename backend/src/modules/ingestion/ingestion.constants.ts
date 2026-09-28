import type { DefaultJobOptions } from 'bullmq';

export const INGESTION_QUEUE = 'ingestion';

/** Jobs carry ids only — never document text — so erasing a document leaves nothing in Redis. */
export interface IngestJobData {
  workspaceId: string;
  documentId: string;
}

export interface DeleteBlobJobData {
  storageKey: string;
}

export type IngestionStatus = 'processing' | 'retrying' | 'ready' | 'failed';

/** Published by the worker via job.updateProgress(); relayed to GraphQL subscribers by the API. */
export interface IngestionProgressEvent {
  workspaceId: string;
  documentId: string;
  status: IngestionStatus;
  percent: number;
  chunkCount?: number;
  error?: string | null;
}

export const INGESTION_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export const progressChannel = (workspaceId: string) => `ingestion:${workspaceId}`;
