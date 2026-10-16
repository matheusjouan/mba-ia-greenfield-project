import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — object storage', () => {
  it('should reject a missing S3_ACCESS_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_ACCESS_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ACCESS_KEY');
  });

  it('should reject a missing S3_SECRET_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_SECRET_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_SECRET_KEY');
  });

  it('should default S3_ENDPOINT to the Compose service name', () => {
    const { value } = validate({});
    expect(value.S3_ENDPOINT).toBe('http://minio:9000');
    expect(value.S3_BUCKET).toBe('streamtube');
  });
});

describe('envValidationSchema — queue', () => {
  it('should default REDIS_HOST to the Compose service name', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.QUEUE_PREFIX).toBe('bull');
  });
});

describe('envValidationSchema — video limits', () => {
  it('should apply the 10 GiB size and 100 MiB part defaults', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.VIDEO_MAX_FILE_SIZE_BYTES).toBe(10737418240);
    expect(value.VIDEO_UPLOAD_PART_SIZE_BYTES).toBe(104857600);
    expect(value.VIDEO_UPLOAD_URL_EXPIRATION_SECONDS).toBe(3600);
    expect(value.VIDEO_PLAYBACK_URL_EXPIRATION_SECONDS).toBe(14400);
  });

  it('should reject a part size below the 5 MiB S3 minimum', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '1048576' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_UPLOAD_PART_SIZE_BYTES');
  });

  it('should accept the 5 MiB minimum part size', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '5242880' });
    expect(error).toBeUndefined();
  });
});
