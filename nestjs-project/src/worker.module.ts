import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configModuleOptions } from './config/config-module.options';
import databaseConfig from './config/database.config';
import queueConfig from './config/queue.config';
import { typeOrmOptions } from './database/typeorm.options';
import { bullRootOptions } from './queues/bull-root.options';
import { UsersModule } from './users/users.module';
import { VideoWorkerModule } from './video-worker/video-worker.module';

/** Root module of the video worker process: no HTTP server, only the queue consumer. */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) =>
        typeOrmOptions(dbConfig),
    }),
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) =>
        bullRootOptions(config),
    }),
    // autoLoadEntities only sees entities of imported modules: Channel references User
    UsersModule,
    VideoWorkerModule,
  ],
})
export class WorkerModule {}
