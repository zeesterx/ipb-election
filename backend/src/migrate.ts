import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from './database';

async function main() {
  const directories = [
    resolve(process.cwd(), '../supabase/migrations'),
    resolve(process.cwd(), 'supabase/migrations')
  ];
  let migrationDirectory: string | undefined;
  let migrationFiles: string[] = [];
  for (const directory of directories) {
    try {
      migrationFiles = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
      migrationDirectory = directory;
      break;
    } catch {
      // Try the next location (workspace development vs. Docker image).
    }
  }
  if (!migrationDirectory || migrationFiles.length === 0) throw new Error('Migration files not found');
  const db = new Database();
  for (const file of migrationFiles) {
    const sql = await readFile(resolve(migrationDirectory, file), 'utf8');
    await db.query(sql);
  }
  await db.onModuleDestroy();
  process.stdout.write(`${migrationFiles.length} database migration(s) applied.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
