/**
 * Database connection. Uses Neon's fast HTTP driver when DATABASE_URL points
 * at Neon, and the standard Postgres driver for any other Postgres server
 * (handy for local testing or moving off Neon later).
 */
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

let cached: Query | null = null;

export function getDb(): Query {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Add your Neon connection string to the environment.');

  if (/neon\.tech|neon\.build/.test(url)) {
    const sql = neon(url);
    cached = async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[];
  } else {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    cached = async (text, params = []) => (await pool.query(text, params as unknown[])).rows;
  }
  return cached;
}
