import { expect, test } from "bun:test";
import { onboardProvider } from "../src/onboarding";

test("returns a manual checkpoint and never claims signup completion", async () => {
  // Given a catalog provider and a deterministic Aside runner.
  const calls: string[] = [];
  const result = await onboardProvider("sambanova", {
    runAside: async (args) => {
      calls.push(args.join(" "));
      return "CHECKPOINT_LOGIN_OR_TERMS";
    },
  });
  // When the browser reaches a checkpoint, then the state remains actionable.
  expect(result.status).toBe("needs_user_action");
  expect(result.completed).toBe(false);
  expect(calls[0]?.startsWith("aside repl ")).toBe(true);
  expect(calls[0]).toContain("https://cloud.sambanova.ai/");
});

test("rejects a provider that is absent from the HTTPS catalog", async () => {
  await expect(onboardProvider("not-a-provider", { runAside: async () => "" })).rejects.toThrow(
    "Unknown provider",
  );
});

test("redacts credential-shaped Aside output before returning a transcript", async () => {
  const result = await onboardProvider("sambanova", {
    runAside: async () => "authorization=Bearer abcdefghijklmnopqrstuvwxyz1234567890",
  });

  expect(result.transcript).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  expect(result.transcript).toContain("[redacted]");
});
