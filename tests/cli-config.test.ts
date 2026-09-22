import { expect, test } from "bun:test";
import { requireGatewayToken, requireLoopbackHost } from "../src/cli-config";

test("rejects non-loopback bind addresses", () => {
  expect(() => requireLoopbackHost("0.0.0.0")).toThrow("loopback");
  expect(requireLoopbackHost("127.0.0.1")).toBe("127.0.0.1");
});

test("requires an explicitly configured local bearer token", () => {
  expect(() => requireGatewayToken(undefined)).toThrow("GATEWAY_TOKEN");
  expect(requireGatewayToken("local-token")).toBe("local-token");
});
