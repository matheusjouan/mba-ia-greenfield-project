import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => {
  const endpoint = process.env.S3_ENDPOINT || 'http://minio:9000';

  return {
    endpoint,
    // Host embedded in presigned URLs handed to clients. SigV4 signs the host,
    // so it must be the address the client reaches — defaults to the internal one.
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET || 'streamtube',
  };
});
