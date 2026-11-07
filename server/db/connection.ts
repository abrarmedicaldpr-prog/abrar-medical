import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

let dbInstance: Database.Database | null = null;
let connectionError: string | null = null;

export interface ConnectionDiagnostics {
  connected: boolean;
  driver: string;
  databasePath: string;
  databaseDirectoryExists: boolean;
  fileExists: boolean;
  fileSizeBytes: number;
  journalMode: string;
  foreignKeysEnabled: boolean;
  integrityCheck: string;
  tableCount: number;
  tables: string[];
  latencyMs: number;
  checkedAt: string;
  error?: string | null;
}

/**
 * Initializes and returns the active SQLite database instance.
 * Ensures the target directory exists and PRAGMAs are strictly enforced.
 */
export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    const dbDir = path.dirname(config.databasePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(config.databasePath, {
      verbose: config.nodeEnv === 'development' ? undefined : undefined,
    });

    // Enforce relational integrity and high reliability write-ahead logging
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('synchronous = NORMAL');

    connectionError = null;
    return dbInstance;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    connectionError = errorMsg;
    throw new Error(`Database connection failed at ${config.databasePath}: ${errorMsg}`);
  }
}

/**
 * Safely checkpoints WAL and closes the active SQLite connection (used during database restoration).
 */
export function closeDatabaseConnection(): void {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore checkpoint error if closing
    }
    try {
      dbInstance.close();
    } catch {
      // ignore close error
    }
    dbInstance = null;
  }
}

/**
 * Forces a fresh SQLite connection after restoration.
 */
export function reopenDatabaseConnection(): Database.Database {
  closeDatabaseConnection();
  return getDatabase();
}

/**
 * Performs a live connectivity and integrity test.
 * Never assumes connection; verifies via actual PRAGMA and SQL queries.
 */
export function checkDatabaseConnection(): ConnectionDiagnostics {
  const start = performance.now();
  const dbDir = path.dirname(config.databasePath);
  const dirExists = fs.existsSync(dbDir);
  const fileExists = fs.existsSync(config.databasePath);
  let fileSizeBytes = 0;

  if (fileExists) {
    try {
      const stats = fs.statSync(config.databasePath);
      fileSizeBytes = stats.size;
    } catch {
      // ignore stat errors
    }
  }

  try {
    const db = getDatabase();

    // 1. Live ping query
    const ping = db.prepare('SELECT 1 as test').get() as { test: number } | undefined;
    if (!ping || ping.test !== 1) {
      throw new Error('Database ping query returned unexpected result.');
    }

    // 2. Pragmas verification
    const journalResult = db.pragma('journal_mode', { simple: true }) as string;
    const foreignKeyResult = db.pragma('foreign_keys', { simple: true }) as number;
    const integrityResult = db.pragma('integrity_check', { simple: true }) as string;

    // 3. Inspect existing tables
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tableRows.map((r) => r.name);
    const latency = Math.round((performance.now() - start) * 100) / 100;

    return {
      connected: true,
      driver: 'better-sqlite3 (Persistent File Storage)',
      databasePath: config.databasePath,
      databaseDirectoryExists: dirExists,
      fileExists: fs.existsSync(config.databasePath),
      fileSizeBytes: fileSizeBytes || (fs.existsSync(config.databasePath) ? fs.statSync(config.databasePath).size : 0),
      journalMode: String(journalResult).toLowerCase(),
      foreignKeysEnabled: foreignKeyResult === 1,
      integrityCheck: String(integrityResult),
      tableCount: tableNames.length,
      tables: tableNames,
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      driver: 'better-sqlite3 (Persistent File Storage)',
      databasePath: config.databasePath,
      databaseDirectoryExists: dirExists,
      fileExists,
      fileSizeBytes,
      journalMode: 'unknown',
      foreignKeysEnabled: false,
      integrityCheck: 'failed',
      tableCount: 0,
      tables: [],
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
      checkedAt: new Date().toISOString(),
      error: errorMsg || connectionError,
    };
  }
}
