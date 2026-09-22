import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayState, type Route } from "../src/state";

const resources: { home: string; state: GatewayState }[] = [];
afterEach(() => {
  for (const { home, state } of resources.splice(0)) {
    state.close();
    rmSync(home, { recursive: true, force: true });
  }
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "gateway-state-"));
  const state = new GatewayState(home);
  resources.push({ home, state });
  return { home, state };
}
const now = Date.parse("2026-09-21T00:00:00Z");
const route: Route = {
  id: "sambanova/deepseek",
  provider: "sambanova",
  model: "DeepSeek-V3.1",
  aliases: ["deepseek"],
  pool: "sambanova/deepseek",
  dailyRequests: 1,
  dailyTokens: 1000,
  verifiedUntil: now + 86_400_000,
  freeOnly: true,
  commercial: true,
  baseUrl: "https://fixture.invalid/v1",
};

test("reserves the last shared-pool request exactly once across connections", async () => {
  // Given two DB connections sharing a single remaining request.
  const { home, state } = fixture();
  state.add(route, "test-upstream-secret");
  const second = new GatewayState(home);
  try {
    // When callers contend without sleeps, then one is admitted.
    const results = await Promise.all([
      Promise.resolve().then(() => state.reserve(route.id, 100, now)),
      Promise.resolve().then(() => second.reserve(route.id, 100, now)),
    ]);
    expect(results.filter((id) => id !== null)).toHaveLength(1);
  } finally {
    second.close();
  }
});

test("shares quota across distinct models in the same provider pool", () => {
  // Given two models using the same allowance.
  const { state } = fixture();
  state.add(route, "test-upstream-secret");
  state.add({ ...route, id: "other", model: "other" }, "test-upstream-secret");
  // When the allowance is consumed, then the sibling route cannot duplicate it.
  expect(state.reserve(route.id, 900, now)).not.toBeNull();
  expect(state.reserve("other", 200, now)).toBeNull();
});

test("persists quota reservations across reopening", () => {
  // Given an exhausted on-disk allowance.
  const { home, state } = fixture();
  state.add(route, "test-upstream-secret");
  expect(state.reserve(route.id, 100, now)).not.toBeNull();
  const reopened = new GatewayState(home);
  try {
    // When another connection reopens it, then exhaustion survives.
    expect(reopened.reserve(route.id, 100, now)).toBeNull();
  } finally {
    reopened.close();
  }
});

test("does not admit expired or unverified account conditions", () => {
  // Given a route whose free proof has expired.
  const { state } = fixture();
  state.add({ ...route, verifiedUntil: now - 1 }, "test-secret");
  // When admission is requested, then it fails closed.
  expect(state.reserve(route.id, 100, now)).toBeNull();
});

test("rejects an explicitly paid route at registration", () => {
  // Given a route with no free-only guarantee.
  const { state } = fixture();
  // When registered, then fail before persisting credentials.
  expect(() => state.add({ ...route, freeOnly: false }, "test-secret")).toThrow();
});

test("protects credentials on disk and does not expose them in route metadata", () => {
  // Given a configured provider secret.
  const { home, state } = fixture();
  state.add(route, "never-include-this-secret");
  // When public metadata is inspected, then the secret is absent and disk is owner-only.
  expect(state.routes()).toHaveLength(1);
  expect(JSON.stringify(state.routes())).not.toContain("never-include-this-secret");
  expect(statSync(join(home, "state.sqlite")).mode & 0o777).toBe(0o600);
});

test("reopens a stored route with its decrypted secret for serving", () => {
  // Given a configured route persisted by provider add.
  const { home, state } = fixture();
  state.add(route, "persisted-upstream-secret");
  const reopened = new GatewayState(home);
  try {
    // When the process restarts, then serving can recover the route without its env key.
    expect(reopened.loadRoutes()).toMatchObject([
      { id: route.id, baseUrl: route.baseUrl, secret: "persisted-upstream-secret" },
    ]);
  } finally {
    reopened.close();
  }
});

test("migrates a pre-base-url database without crashing", () => {
  // Given a database created by the pre-persistence schema.
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-old-"));
  writeFileSync(join(home, "secret.key"), randomBytes(32), { mode: 0o600 });
  const old = new Database(join(home, "state.sqlite"));
  old.exec(`
    CREATE TABLE routes (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
      aliases TEXT NOT NULL, pool TEXT NOT NULL, daily_requests INTEGER NOT NULL,
      daily_tokens INTEGER NOT NULL, verified_until INTEGER NOT NULL,
      free_only INTEGER NOT NULL, commercial INTEGER NOT NULL, secret BLOB NOT NULL
    );
    CREATE TABLE usage (
      pool TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pool, day)
    );
  `);
  old.close();
  // When the new process opens it, then the compatibility column is added.
  const migrated = new GatewayState(home);
  resources.push({ home, state: migrated });
  expect(migrated.routes()).toEqual([]);
});
