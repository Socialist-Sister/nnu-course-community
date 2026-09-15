// Accepted direction: a persistent local catalog with a separate HTTP API; preserve the third design.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateReviews } from './review-schema.mjs';
import { migrateAccounts } from './accounts-schema.mjs';
import { migrateEmail } from './email-schema.mjs';
import { migrateAccountDeletion } from './account-deletion-schema.mjs';
import { migrateProfiles } from './profiles.mjs';
import { migrateBookmarks } from './bookmarks.mjs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const defaultDbPath = resolve(root, 'database/catalog.sqlite');
export function openDatabase(filename = process.env.DATABASE_PATH || defaultDbPath, { readOnly = false } = {}) {
  if (filename !== ':memory:' && !readOnly) mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename, { readOnly, timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(readFileSync(resolve(root, 'server/schema.sql'), 'utf8'));
    migrateReviews(db);
    migrateAccounts(db);
    migrateEmail(db);
    migrateAccountDeletion(db);
    migrateProfiles(db);
    migrateBookmarks(db);
  }
  return db;
}
