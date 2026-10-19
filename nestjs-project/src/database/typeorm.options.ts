import type { ConfigType } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';

/** TypeORM connection shared by the API (AppModule) and the video worker. */
export function typeOrmOptions(
  dbConfig: ConfigType<typeof databaseConfig>,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.name,
    autoLoadEntities: true,
    synchronize: false,
  };
}
