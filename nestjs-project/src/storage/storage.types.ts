export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface StoredPart extends CompletedPart {
  size: number;
}

export interface PresignGetOptions {
  expiresIn: number;
  /** `public` signs for S3_PUBLIC_ENDPOINT (clients); `internal` for S3_ENDPOINT (worker). */
  endpoint: 'public' | 'internal';
  /** When set, the storage answers with `Content-Disposition: attachment`. */
  downloadFileName?: string;
}
