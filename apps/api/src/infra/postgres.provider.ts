import { Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_CONFIG, AppConfig, PG_POOL } from '../config/config.module';

export async function runMigrations(pool: Pool): Promise<void> {
  const sql = readFileSync(
    join(process.cwd(), 'db/migrations/001_create_transactions.sql'),
    'utf8',
  );
  await pool.query(sql);
}

export const postgresProvider: Provider = {
  provide: PG_POOL,
  inject: [APP_CONFIG],
  useFactory: async (cfg: AppConfig) => {
    const pool = new Pool({ connectionString: cfg.pgUrl, max: 20 });
    await runMigrations(pool);
    return pool;
  },
};
