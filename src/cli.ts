#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { requireGatewayToken, requireLoopbackHost } from "./cli-config";
import {
  createGateway,
  estimate,
  type FreeRoute,
  GatewayState,
  isConfirmedFreeModel,
  loadCatalog,
  onboardProvider,
} from "./index";

function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function help(): void {
  console.log(`gateway init [--json]
gateway doctor [--json]
gateway status --json
gateway env --json
gateway catalog --json
gateway estimate --json
gateway serve --host 127.0.0.1 --port 18473
gateway provider add --provider openrouter --key-env OPENROUTER_API_KEY --model openrouter/free --free-model
gateway onboard --provider sambanova --browser aside --json
`);
}

function env(name: string): string | undefined {
  const value = Reflect.get(process.env, name);
  return typeof value === "string" ? value : undefined;
}

type ProviderDefault = {
  readonly baseUrl: string;
  readonly dailyRequests: number;
  readonly dailyTokens: number;
};

type RouteDiagnostic = {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly aliases: readonly string[];
  readonly credentialStored: boolean;
  readonly freeVerified: boolean;
  readonly liveVerified: false;
  readonly eligibility: "eligible" | "expired" | "ineligible" | "missing_credential";
  readonly reason: string | null;
};

const PROVIDER_DEFAULTS: Readonly<Record<string, ProviderDefault>> = {
  sambanova: {
    baseUrl: "https://api.sambanova.ai/v1",
    dailyRequests: 20,
    dailyTokens: 200_000,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    dailyRequests: 50,
    dailyTokens: 204_800,
  },
  requesty: {
    baseUrl: "https://router.requesty.ai/v1",
    dailyRequests: 200,
    dailyTokens: 819_200,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    dailyRequests: 1,
    dailyTokens: 4096,
  },
  huggingface: {
    baseUrl: "https://router.huggingface.co/v1",
    dailyRequests: 1,
    dailyTokens: 4096,
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    dailyRequests: 1,
    dailyTokens: 4096,
  },
};

function makeConfiguredRoute(
  provider: string,
  model: string,
  alias: string,
  secret: string,
): FreeRoute {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (defaults === undefined) {
    throw new Error(`Provider ${provider} has no safe OpenAI-compatible route`);
  }
  const normalizedModel = model.toLowerCase();
  return {
    id: `${provider}/${normalizedModel}`,
    provider,
    model,
    aliases: [alias],
    pool: `${provider}/${normalizedModel}`,
    dailyRequests: defaults.dailyRequests,
    dailyTokens: defaults.dailyTokens,
    verifiedUntil: Date.now() + 86_400_000,
    freeOnly: true,
    commercial: true,
    baseUrl: defaults.baseUrl,
    secret,
  };
}

function configuredRoutes(): readonly FreeRoute[] {
  const key = env("SAMBANOVA_API_KEY");
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    env("GATEWAY_ENABLE_SAMBANOVA") !== "1" ||
    env("GATEWAY_CONFIRM_FREE") !== "1" ||
    env("GATEWAY_CONFIRM_COMMERCIAL") !== "1"
  ) {
    return [];
  }
  return [
    {
      id: "sambanova/deepseek-v3.1",
      provider: "sambanova",
      model: "DeepSeek-V3.1",
      aliases: ["deepseek", "deepseek-v3.1"],
      pool: "sambanova/deepseek-v3.1",
      dailyRequests: 20,
      dailyTokens: 200_000,
      verifiedUntil: Date.now() + 86_400_000,
      freeOnly: true,
      commercial: true,
      baseUrl: "https://api.sambanova.ai/v1",
      secret: key,
    },
  ];
}

function gatewayHome(): string {
  const configured = env("GATEWAY_HOME");
  return configured === undefined || configured.length === 0
    ? join(homedir(), ".everyone-gateway")
    : configured;
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === "string" && !value.startsWith("--") ? value : undefined;
}

function routeDiagnostics(home: string, now: number): readonly RouteDiagnostic[] {
  if (!existsSync(home)) return [];
  const state = new GatewayState(home);
  try {
    const routes = state.routes();
    const storedIds = new Set(state.loadRoutes().map((route) => route.id));
    return routes.map((route) => {
      const credentialStored = storedIds.has(route.id);
      const freeVerified =
        route.freeOnly && route.commercial && isConfirmedFreeModel(route.provider, route.model);
      const eligibility: RouteDiagnostic["eligibility"] = !credentialStored
        ? "missing_credential"
        : route.verifiedUntil <= now
          ? "expired"
          : !freeVerified
            ? "ineligible"
            : "eligible";
      const reason =
        eligibility === "expired"
          ? "Local free verification has expired."
          : eligibility === "ineligible"
            ? "Route is not confirmed as free and commercial under the local policy."
            : eligibility === "missing_credential"
              ? "No encrypted credential is stored for this route."
              : null;
      return {
        id: route.id,
        provider: route.provider,
        model: route.model,
        aliases: route.aliases,
        credentialStored,
        freeVerified,
        liveVerified: false,
        eligibility,
        reason,
      };
    });
  } finally {
    state.close();
  }
}

function eligibleStoredAliases(home: string, now: number): readonly string[] {
  return routeDiagnostics(home, now)
    .filter((route) => route.eligibility === "eligible")
    .flatMap((route) => route.aliases);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === undefined || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "catalog") {
    const catalog = loadCatalog();
    if (process.argv.includes("--json")) json({ checkedAt: "2026-09-21", providers: catalog });
    else console.log(`${catalog.length} provider records`);
    return;
  }
  if (command === "estimate") {
    const catalog = loadCatalog();
    json(estimate(catalog, new Date()));
    return;
  }
  if (command === "init") {
    const home = gatewayHome();
    const state = new GatewayState(home);
    try {
      const result = {
        status: "initialized",
        home,
        routes: state.routes().length,
        next: [
          "gateway onboard --provider sambanova --browser aside --json",
          "gateway provider add --provider sambanova --key-env SAMBANOVA_API_KEY --model DeepSeek-V3.1 --alias deepseek --free-model",
        ],
      } as const;
      if (process.argv.includes("--json")) json(result);
      else {
        console.log(`Initialized ${home}`);
        console.log("Next:");
        for (const command of result.next) console.log(`  ${command}`);
      }
    } finally {
      state.close();
    }
    return;
  }
  if (command === "doctor") {
    const home = gatewayHome();
    const routes = routeDiagnostics(home, Date.now());
    const issues = routes.filter((route) => route.eligibility !== "eligible");
    const result = {
      status: !existsSync(home) ? "not_initialized" : issues.length > 0 ? "attention" : "ok",
      home,
      liveVerified: false,
      routes,
      issues: issues.map((route) => ({
        id: route.id,
        eligibility: route.eligibility,
        reason: route.reason,
      })),
      next: !existsSync(home) ? ["gateway init"] : [],
    };
    if (process.argv.includes("--json")) json(result);
    else {
      console.log(`${result.status}: ${home}`);
      for (const route of routes) {
        console.log(
          `${route.id}: ${route.eligibility}; credentialStored=${route.credentialStored}; liveVerified=${route.liveVerified}`,
        );
      }
      for (const command of result.next) console.log(`Next: ${command}`);
    }
    return;
  }
  if (command === "env") {
    const model = eligibleStoredAliases(gatewayHome(), Date.now())[0] ?? null;
    json({
      baseUrl: "http://127.0.0.1:18473/v1",
      model,
      tokenVariable: "GATEWAY_TOKEN",
      status: model === null ? "not_configured" : "ready",
      note: "Local gateway settings only; upstream credentials are never printed.",
    });
    return;
  }
  if (command === "status") {
    const home = gatewayHome();
    json({
      home,
      routes: routeDiagnostics(home, Date.now()),
      liveVerified: false,
    });
    return;
  }
  if (command === "provider") {
    if (process.argv[3] !== "add") throw new Error("provider supports only add");
    const providerId = flagValue("--provider");
    const keyEnv = flagValue("--key-env");
    const model = flagValue("--model");
    const alias = flagValue("--alias") ?? model;
    if (
      providerId === undefined ||
      keyEnv === undefined ||
      model === undefined ||
      alias === undefined
    ) {
      throw new Error(
        "provider add requires --provider ID --key-env ENV_NAME --model MODEL [--alias ALIAS]",
      );
    }
    if (!process.argv.includes("--free-model")) {
      throw new Error(
        "provider add requires --free-model after verifying that the selected model is free",
      );
    }
    if (!isConfirmedFreeModel(providerId, model)) {
      throw new Error(`Model ${model} is not confirmed free for provider ${providerId}`);
    }
    const key = env(keyEnv);
    if (key === undefined || key.length === 0) {
      throw new Error(`Environment variable ${keyEnv} is empty or missing`);
    }
    if (env("GATEWAY_CONFIRM_FREE") !== "1" || env("GATEWAY_CONFIRM_COMMERCIAL") !== "1") {
      throw new Error(
        "Set GATEWAY_CONFIRM_FREE=1 and GATEWAY_CONFIRM_COMMERCIAL=1 after verifying the provider terms",
      );
    }
    const route = makeConfiguredRoute(providerId, model, alias, key);
    const state = new GatewayState(gatewayHome());
    try {
      state.add(route, key);
      json({ status: "credential_stored", provider: providerId, liveVerified: false });
    } finally {
      state.close();
    }
    return;
  }
  if (command === "onboard") {
    const providerId = flagValue("--provider");
    if (providerId === undefined || flagValue("--browser") !== "aside") {
      throw new Error("onboard requires --provider ID --browser aside");
    }
    json(await onboardProvider(providerId));
    return;
  }
  if (command === "serve") {
    const args = parseArgs({
      args: process.argv.slice(3),
      options: {
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "18473" },
      },
      strict: true,
    });
    const port = Number(args.values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("port must be an integer from 0 through 65535");
    }
    const configuredToken = Reflect.get(process.env, "GATEWAY_TOKEN");
    const token = requireGatewayToken(
      typeof configuredToken === "string" ? configuredToken : undefined,
    );
    const home = gatewayHome();
    const state = new GatewayState(home);
    const configured = configuredRoutes();
    for (const route of configured) state.add(route, route.secret);
    const routesById = new Map(
      state
        .loadRoutes()
        .filter(
          (route) =>
            route.verifiedUntil > Date.now() &&
            route.freeOnly &&
            route.commercial &&
            isConfirmedFreeModel(route.provider, route.model),
        )
        .map((route) => [route.id, route]),
    );
    for (const route of configured) routesById.set(route.id, route);
    const routes = [...routesById.values()];
    const server = Bun.serve({
      hostname: requireLoopbackHost(args.values.host),
      port,
      fetch: createGateway({
        token,
        routes,
        reserve: (route, tokens) => state.reserve(route.id, tokens, Date.now()) !== null,
      }).fetch,
    });
    console.log(`gateway ready http://${server.hostname}:${server.port}/v1`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        server.stop(true);
        state.close();
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
