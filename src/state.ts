import { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptSecret, encryptSecret } from "./state-crypto";

export type Route = {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly aliases: readonly string[];
  readonly pool: string;
  readonly dailyRequests: number;
  readonly dailyTokens: number;
  readonly verifiedUntil: number;
  readonly freeOnly: boolean;
  readonly commercial: boolean;
  readonly baseUrl: string;
};

export type StoredRoute = Route & { readonly secret: string };

export class GatewayState {
  readonly #db: Database;
  readonly #key: Buffer;

  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
    const databasePath = join(home, "state.sqlite");
    const keyPath = join(home, "secret.key");
    let key: Buffer;
    try {
      key = Buffer.from(readFileSync(keyPath));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      key = Buffer.alloc(0);
    }
    if (key.length !== 32) {
      key = randomBytes(32);
      writeFileSync(keyPath, key, { mode: 0o600 });
      chmodSync(keyPath, 0o600);
    }
    this.#key = key;
    this.#db = new Database(databasePath, { strict: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        aliases TEXT NOT NULL,
        pool TEXT NOT NULL,
        daily_requests INTEGER NOT NULL,
        daily_tokens INTEGER NOT NULL,
        verified_until INTEGER NOT NULL,
        free_only INTEGER NOT NULL,
        commercial INTEGER NOT NULL,
        base_url TEXT NOT NULL,
        secret BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage (
        pool TEXT NOT NULL,
        day TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pool, day)
      );
    `);
    const columns = this.#db.query("PRAGMA table_info(routes)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "base_url")) {
      this.#db.exec('ALTER TABLE routes ADD COLUMN base_url TEXT NOT NULL DEFAULT ""');
    }
    chmodSync(databasePath, 0o600);
  }

  add(route: Route, secret: string) {
    if (!route.freeOnly || !route.commercial || secret.length === 0) {
      throw new Error("Only verified free commercial routes can be registered");
    }
    const encrypted = encryptSecret(this.#key, secret);
    this.#db
      .query(
        `INSERT INTO routes
          (id, provider, model, aliases, pool, daily_requests, daily_tokens,
           verified_until, free_only, commercial, base_url, secret)
         VALUES ($id, $provider, $model, $aliases, $pool, $dailyRequests,
           $dailyTokens, $verifiedUntil, 1, 1, $baseUrl, $secret)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           aliases = excluded.aliases,
           pool = excluded.pool,
           daily_requests = excluded.daily_requests,
           daily_tokens = excluded.daily_tokens,
           verified_until = excluded.verified_until,
           base_url = excluded.base_url,
           secret = excluded.secret`,
      )
      .run({
        id: route.id,
        provider: route.provider,
        model: route.model,
        aliases: JSON.stringify(route.aliases),
        pool: route.pool,
        dailyRequests: route.dailyRequests,
        dailyTokens: route.dailyTokens,
        verifiedUntil: route.verifiedUntil,
        baseUrl: route.baseUrl,
        secret: encrypted,
      });
  }

  routes(): readonly Route[] {
    type RouteRow = {
      id: string;
      provider: string;
      model: string;
      aliases: string;
      pool: string;
      dailyRequests: number;
      dailyTokens: number;
      verifiedUntil: number;
      freeOnly: number;
      commercial: number;
      baseUrl: string;
    };
    const rows = this.#db
      .query(
        `SELECT id, provider, model, aliases, pool, daily_requests AS dailyRequests,
                daily_tokens AS dailyTokens, verified_until AS verifiedUntil,
                free_only AS freeOnly, commercial, base_url AS baseUrl
           FROM routes ORDER BY id`,
      )
      .all() as RouteRow[];
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      aliases: JSON.parse(row.aliases) as readonly string[],
      pool: row.pool,
      dailyRequests: row.dailyRequests,
      dailyTokens: row.dailyTokens,
      verifiedUntil: row.verifiedUntil,
      freeOnly: row.freeOnly === 1,
      commercial: row.commercial === 1,
      baseUrl: row.baseUrl,
    }));
  }

  loadRoutes(): readonly StoredRoute[] {
    type StoredRow = {
      id: string;
      provider: string;
      model: string;
      aliases: string;
      pool: string;
      dailyRequests: number;
      dailyTokens: number;
      verifiedUntil: number;
      freeOnly: number;
      commercial: number;
      baseUrl: string;
      secret: Uint8Array;
    };
    const rows = this.#db
      .query(
        `SELECT id, provider, model, aliases, pool, daily_requests AS dailyRequests,
                daily_tokens AS dailyTokens, verified_until AS verifiedUntil,
                free_only AS freeOnly, commercial, base_url AS baseUrl, secret
           FROM routes ORDER BY id`,
      )
      .all() as StoredRow[];
    return rows
      .map((row) => ({
        id: row.id,
        provider: row.provider,
        model: row.model,
        aliases: JSON.parse(row.aliases) as readonly string[],
        pool: row.pool,
        dailyRequests: row.dailyRequests,
        dailyTokens: row.dailyTokens,
        verifiedUntil: row.verifiedUntil,
        freeOnly: row.freeOnly === 1,
        commercial: row.commercial === 1,
        baseUrl: row.baseUrl,
        secret: decryptSecret(this.#key, Buffer.from(row.secret)),
      }))
      .filter((route) => route.baseUrl.length > 0);
  }
  reserve(id: string, tokens: number, now: number): string | null {
    if (!Number.isSafeInteger(tokens) || tokens <= 0) return null;
    type RouteAdmission = {
      pool: string;
      dailyRequests: number;
      dailyTokens: number;
      verifiedUntil: number;
      freeOnly: number;
      commercial: number;
    };
    const route = this.#db
      .query(
        `SELECT pool, daily_requests AS dailyRequests, daily_tokens AS dailyTokens,
                verified_until AS verifiedUntil, free_only AS freeOnly, commercial
           FROM routes WHERE id = $id`,
      )
      .get({ id }) as RouteAdmission | null;
    if (
      route === null ||
      route.verifiedUntil <= now ||
      route.freeOnly !== 1 ||
      route.commercial !== 1
    ) {
      return null;
    }
    const day = new Date(now).toISOString().slice(0, 10);
    const reservation = randomUUID();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .query(
          `INSERT INTO usage (pool, day, requests, tokens)
           VALUES ($pool, $day, 0, 0)
           ON CONFLICT(pool, day) DO NOTHING`,
        )
        .run({ pool: route.pool, day });
      const usage = this.#db
        .query("SELECT requests, tokens FROM usage WHERE pool = $pool AND day = $day")
        .get({ pool: route.pool, day }) as {
        requests: number;
        tokens: number;
      };
      if (usage.requests >= route.dailyRequests || usage.tokens + tokens > route.dailyTokens) {
        this.#db.exec("ROLLBACK");
        return null;
      }
      this.#db
        .query(
          `UPDATE usage SET requests = requests + 1, tokens = tokens + $tokens
           WHERE pool = $pool AND day = $day`,
        )
        .run({ tokens, pool: route.pool, day });
      this.#db.exec("COMMIT");
      return reservation;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.#db.close();
  }
}
