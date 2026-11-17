import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Integration tests run against a real PostgreSQL. Set TEST_DATABASE_URL to an
 * admin connection (e.g. postgres://postgres@localhost:54329/postgres). Each run
 * creates a throw-away database, applies a Supabase auth stub + all migrations.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ROOT = join(__dirname, "..", "..");

export async function createTestDatabase(throughMigration?: string): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL not set");
  const name = `nemesis_it_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    // Roles are cluster-wide even though each suite owns a different database.
    // Hold the lock on the shared admin database while creating the auth roles.
    await admin.query("select pg_advisory_lock(73112201)");
    await db.query(readFileSync(join(ROOT, "tests/integration/auth-stub.sql"), "utf8"));
  } finally {
    await admin.end(); // Releasing the session also releases its advisory lock.
  }
  const dir = join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && (!throughMigration || f <= throughMigration)).sort()) {
    await db.query(readFileSync(join(dir, file), "utf8"));
  }
  await db.end();

  return {
    url: url.toString(),
    drop: async () => {
      const a = new Client({ connectionString: TEST_DATABASE_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** A connection acting as the Next.js server (service_role). */
export async function serviceClient(url: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("set role service_role");
  return c;
}

/** A connection acting as a signed-in browser user (RLS applies). */
export async function userClient(url: string, userId: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("set role authenticated");
  await c.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return c;
}
