import type { ConfigType } from '@nestjs/config';
import type { QueueOptions } from 'bullmq';
import queueConfig from '../config/queue.config';

/** Root BullMQ connection shared by the API, the worker and the tests. */
export function bullRootOptions(
  config: ConfigType<typeof queueConfig>,
): QueueOptions {
  return {
    connection: { host: config.redisHost, port: config.redisPort },
    prefix: config.prefix,
  };
}
