import { Hono } from "hono";
import { z } from "zod";

export type FreeRoute = {
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
  readonly secret: string;
};

type GatewayOptions = {
  readonly token: string;
  readonly routes: readonly FreeRoute[];
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly reserve?: (route: FreeRoute, tokens: number) => boolean;
};

const requestSchema = z
  .object({
    model: z.string().min(1).max(200),
    messages: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    max_tokens: z.number().int().positive().max(8192).optional(),
    max_completion_tokens: z.number().int().positive().max(8192).optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

const auth = (request: Request, token: string) =>
  request.headers.get("authorization") === `Bearer ${token}`;

const jsonError = (status: 400 | 401 | 413 | 503, code: string, message: string) =>
  Response.json({ error: { code, message, type: "gateway_error" } }, { status });

function routeMatches(route: FreeRoute, model: string, now: number): boolean {
  return (
    route.freeOnly &&
    route.commercial &&
    route.verifiedUntil > now &&
    (route.model === model || route.aliases.includes(model))
  );
}

export function createGateway(options: GatewayOptions) {
  const app = new Hono();
  const fetchImpl = options.fetchImpl ?? fetch;
  const routes = options.routes;
  const usage = new Map<string, { day: string; requests: number; tokens: number }>();
  const reserve =
    options.reserve ??
    ((route: FreeRoute, tokens: number): boolean => {
      const day = new Date().toISOString().slice(0, 10);
      const current = usage.get(route.pool);
      const entry = current?.day === day ? current : { day, requests: 0, tokens: 0 };
      if (entry.requests >= route.dailyRequests || entry.tokens + tokens > route.dailyTokens) {
        return false;
      }
      entry.requests += 1;
      entry.tokens += tokens;
      usage.set(route.pool, entry);
      return true;
    });

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("/v1/*", async (c, next) => {
    if (!auth(c.req.raw, options.token)) {
      return c.json({ error: { code: "unauthorized", message: "Bearer token required" } }, 401);
    }
    await next();
  });
  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: routes
        .filter((route) => route.freeOnly && route.commercial)
        .map((route) => ({
          id: route.aliases[0] ?? route.model,
          object: "model",
          owned_by: route.provider,
        })),
    }),
  );
  app.post("/v1/chat/completions", async (c) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > 1_048_576) {
      return jsonError(413, "request_too_large", "Request body exceeds 1 MiB");
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(400, "invalid_json", "Request body must be JSON");
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "invalid_request", "Unsupported or malformed chat request");
    }
    const requestedModel = parsed.data.model;
    const requestedTokens = parsed.data.max_tokens ?? parsed.data.max_completion_tokens ?? 256;
    const candidates = routes.filter((route) => routeMatches(route, requestedModel, Date.now()));
    if (candidates.length === 0) {
      return jsonError(503, "no_free_capacity", "No eligible free route is configured");
    }
    for (const route of candidates) {
      if (!reserve(route, requestedTokens)) continue;
      const controller = new AbortController();
      c.req.raw.signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const upstreamBody = {
          ...parsed.data,
          model: route.model,
          ...(route.provider === "openrouter"
            ? {
                provider: {
                  max_price: { prompt: 0, completion: 0, request: 0 },
                  allow_fallbacks: false,
                },
              }
            : {}),
        };
        const upstream = await fetchImpl(`${route.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${route.secret}`,
            "content-type": "application/json",
            accept: parsed.data.stream === true ? "text/event-stream" : "application/json",
          },
          body: JSON.stringify(upstreamBody),
          signal: controller.signal,
        });
        if (upstream.ok) {
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        }
        if (![408, 429, 500, 502, 503, 504].includes(upstream.status)) {
          return jsonError(503, "upstream_rejected", "Eligible free provider rejected the request");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return jsonError(503, "client_disconnected", "Client disconnected");
        }
      }
    }
    return jsonError(503, "no_free_capacity", "Eligible free routes are unavailable");
  });
  return app;
}
