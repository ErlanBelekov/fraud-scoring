import { Module, Global } from '@nestjs/common';

export const PG_POOL = 'PG_POOL';
export const REDIS = 'REDIS';

export interface AppConfig {
  pgUrl: string;
  redisUrl: string;
}

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => ({
        pgUrl: process.env.PG_URL ?? 'postgres://fraud:fraud@localhost:5432/fraud',
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
      }),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
