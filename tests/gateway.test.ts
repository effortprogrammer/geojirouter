import { describe, expect, test } from "bun:test";
import { createGateway, type FreeRoute } from "../src/gateway";

const token = "local-gateway-test-token";
const route: FreeRoute = {
  id: "fixture/deepseek",
  provider: "fixture",
  model: "DeepSeek-V3.1",
  aliases: ["deepseek"],
  pool: "fixture/deepseek",
  dailyRequests: 5,
  dailyTokens: 5000,
  verifiedUntil: Date.now() + 60_000,
  freeOnly: true,
  commercial: true,
  baseUrl: "https://fixture.invalid/v1",
  secret: "upstream-secret-must-not-leak",
};

describe("local zero-cost gateway", () => {
  test("requires the local bearer token", async () => {
    const app = createGateway({ token, routes: [] });
    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(401);
  });

  test("fails closed when no eligible route is configured", async () => {
    const app = createGateway({ token, routes: [] });
    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "no_free_capacity" } });
  });

  test("proxies a compatible completion without exposing the upstream secret", async () => {
    const calls: Request[] = [];
    const app = createGateway({
      token,
      routes: [route],
      fetchImpl: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json({
          id: "chatcmpl-fixture",
          object: "chat.completion",
          model: route.model,
          choices: [
            { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
          ],
        });
      },
    });
    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("OK");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer upstream-secret-must-not-leak");
  });

  test("pins OpenRouter upstream calls to zero price without fallback", async () => {
    const calls: Request[] = [];
    const app = createGateway({
      token,
      routes: [{ ...route, provider: "openrouter", baseUrl: "https://openrouter.invalid/v1" }],
      fetchImpl: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json({ choices: [] });
      },
    });
    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    const body = await calls[0]?.json();
    expect(response.status).toBe(200);
    expect(body.provider).toEqual({
      max_price: { prompt: 0, completion: 0, request: 0 },
      allow_fallbacks: false,
    });
  });

  test("returns no-free-capacity after a route reservation is exhausted", async () => {
    const app = createGateway({
      token,
      routes: [{ ...route, dailyRequests: 0 }],
      fetchImpl: async () => {
        throw new Error("paid or unreachable upstream must never be called");
      },
    });
    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("paid");
  });

  test("reserves only the route that is actually dispatched", async () => {
    // Given two eligible routes and a request that succeeds on the first.
    const second = { ...route, id: "fixture/second", pool: "fixture/second" };
    const reserved: string[] = [];
    const app = createGateway({
      token,
      routes: [route, second],
      reserve: (candidate) => {
        reserved.push(candidate.id);
        return true;
      },
      fetchImpl: async () =>
        Response.json({
          id: "chatcmpl-fixture",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" } }],
        }),
    });
    // When dispatched, then the unused sibling is not charged.
    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    expect(response.status).toBe(200);
    expect(reserved).toEqual([route.id]);
  });
});
