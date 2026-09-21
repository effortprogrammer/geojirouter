import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayState } from "../src/state";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function runCli(home: string, args: readonly string[], key?: string) {
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      GATEWAY_HOME: home,
      GATEWAY_ENABLE_SAMBANOVA: "1",
      GATEWAY_CONFIRM_FREE: "1",
      GATEWAY_CONFIRM_COMMERCIAL: "1",
      ...(key === undefined ? { SAMBANOVA_API_KEY: undefined } : { SAMBANOVA_API_KEY: key }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${stderr}\n${stdout}`);
  return JSON.parse(stdout) as {
    routes?: readonly Record<string, unknown>[];
    model?: string | null;
    status?: string;
    next?: readonly string[];
  };
}

async function runCliFailure(home: string, args: readonly string[]) {
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      GATEWAY_HOME: home,
      GATEWAY_CONFIRM_FREE: "1",
      GATEWAY_CONFIRM_COMMERCIAL: "1",
      GROQ_API_KEY: "not-used",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).not.toBe(0);
  return `${stderr}\n${stdout}`;
}

test("init creates an empty portable home and actionable next commands", async () => {
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-init-"));
  homes.push(home);

  const result = await runCli(home, ["init", "--json"]);

  expect(result.status).toBe("initialized");
  expect(result.next).toEqual([
    "gateway onboard --provider sambanova --browser aside --json",
    "gateway provider add --provider sambanova --key-env SAMBANOVA_API_KEY --model DeepSeek-V3.1 --alias deepseek --free-model",
  ]);
});

test("env uses an eligible stored alias and never prints the upstream credential", async () => {
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-env-"));
  homes.push(home);
  await runCli(
    home,
    [
      "provider",
      "add",
      "--provider",
      "sambanova",
      "--key-env",
      "SAMBANOVA_API_KEY",
      "--model",
      "DeepSeek-V3.1",
      "--alias",
      "samba-free",
      "--free-model",
    ],
    "stored-secret",
  );

  const result = await runCli(home, ["env", "--json"]);

  expect(result.model).toBe("samba-free");
  expect(JSON.stringify(result)).not.toContain("stored-secret");
});

test("doctor distinguishes stored credentials from local free and live verification", async () => {
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-doctor-"));
  homes.push(home);
  const state = new GatewayState(home);
  try {
    state.add(
      {
        id: "sambanova/expired",
        provider: "sambanova",
        model: "DeepSeek-V3.1",
        aliases: ["expired"],
        pool: "sambanova/expired",
        dailyRequests: 20,
        dailyTokens: 200_000,
        verifiedUntil: Date.now() - 1,
        freeOnly: true,
        commercial: true,
        baseUrl: "https://api.sambanova.ai/v1",
      },
      "expired-secret",
    );
    state.add(
      {
        id: "sambanova/ineligible",
        provider: "sambanova",
        model: "not-a-confirmed-free-model",
        aliases: ["ineligible"],
        pool: "sambanova/ineligible",
        dailyRequests: 20,
        dailyTokens: 200_000,
        verifiedUntil: Date.now() + 86_400_000,
        freeOnly: true,
        commercial: true,
        baseUrl: "https://api.sambanova.ai/v1",
      },
      "ineligible-secret",
    );
  } finally {
    state.close();
  }

  const result = await runCli(home, ["doctor", "--json"]);
  const routes = result.routes ?? [];
  expect(routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "sambanova/expired",
        credentialStored: true,
        freeVerified: true,
        liveVerified: false,
        eligibility: "expired",
      }),
      expect.objectContaining({
        id: "sambanova/ineligible",
        credentialStored: true,
        freeVerified: false,
        liveVerified: false,
        eligibility: "ineligible",
      }),
    ]),
  );
  expect(JSON.stringify(result)).not.toContain("secret");
});

test("provider add persists a route that serve can expose after env key removal", async () => {
  // Given a user adds a confirmed free route with a key available only during setup.
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-cli-"));
  homes.push(home);
  await runCli(
    home,
    [
      "provider",
      "add",
      "--provider",
      "sambanova",
      "--key-env",
      "SAMBANOVA_API_KEY",
      "--model",
      "DeepSeek-V3.1",
      "--alias",
      "deepseek",
      "--free-model",
    ],
    "stored-secret",
  );
  // When the process is queried without the upstream key, then persisted metadata remains usable.
  const status = await runCli(home, ["status", "--json"]);
  expect(status.routes).toMatchObject([{ id: "sambanova/deepseek-v3.1" }]);
  const server = Bun.spawn(["bun", "src/cli.ts", "serve", "--host", "127.0.0.1", "--port", "0"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, GATEWAY_HOME: home, GATEWAY_TOKEN: "local-test-token" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const ready = (async (): Promise<number> => {
      const reader = server.stdout.getReader();
      let output = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("server exited before readiness");
        output += new TextDecoder().decode(chunk.value);
        const line = output.split("\n").find((candidate) => candidate.startsWith("gateway ready "));
        if (line !== undefined) {
          const match = /^gateway ready http:\/\/127\.0\.0\.1:(\d+)\/v1$/.exec(line);
          if (match === null) throw new Error(`unexpected readiness signal: ${line}`);
          return Number(match[1]);
        }
      }
    })();
    const port = await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("server readiness timeout")), 10_000),
      ),
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: "Bearer local-test-token" },
    });
    expect(await response.json()).toMatchObject({
      data: [{ id: "deepseek" }],
    });
  } finally {
    server.kill();
    await server.exited;
  }
});

test("provider add rejects a model outside the confirmed free policy", async () => {
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-policy-"));
  homes.push(home);
  const child = Bun.spawn(
    [
      "bun",
      "src/cli.ts",
      "provider",
      "add",
      "--provider",
      "openrouter",
      "--key-env",
      "OPENROUTER_API_KEY",
      "--model",
      "openai/gpt-4o",
      "--free-model",
    ],
    {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        GATEWAY_HOME: home,
        OPENROUTER_API_KEY: "should-not-be-stored",
        GATEWAY_CONFIRM_FREE: "1",
        GATEWAY_CONFIRM_COMMERCIAL: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("not confirmed free");
  expect(stdout).not.toContain("should-not-be-stored");
});

test("provider add rejects models absent from the confirmed-free policy", async () => {
  const home = mkdtempSync(join(tmpdir(), "everyone-gateway-policy-"));
  homes.push(home);

  const output = await runCliFailure(home, [
    "provider",
    "add",
    "--provider",
    "groq",
    "--key-env",
    "GROQ_API_KEY",
    "--model",
    "llama-3.3-70b-versatile",
    "--free-model",
  ]);

  expect(output).toContain("not confirmed free");
});
