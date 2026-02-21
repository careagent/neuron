import Database from 'better-sqlite3'
import type { StorageEngine, RunResult } from './interface.js'
import { runMigrations } from './migrations.js'

/**
 * SQLite implementation of the StorageEngine interface.
 *
 * Uses better-sqlite3 for synchronous database operations with WAL mode
 * and foreign key enforcement. Supports both file-backed and in-memory
 * databases (pass ':memory:' for tests).
 */
export class SqliteStorage implements StorageEngine {
  private db: Database.Database

  /**
   * @param path - Path to the SQLite database file, or ':memory:' for in-memory
   */
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  initialize(): void {
    runMigrations(this.db)
  }

  close(): void {
    this.db.close()
  }

  run(sql: string, params: unknown[] = []): RunResult {
    const result = this.db.prepare(sql).run(...params)
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    }
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn)
    return wrapped()
  }
}
