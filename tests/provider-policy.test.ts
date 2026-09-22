import { expect, test } from "bun:test";
import { isConfirmedFreeModel } from "../src/provider-policy";

test("admits only known free model identifiers", () => {
  expect(isConfirmedFreeModel("sambanova", "DeepSeek-V3.1")).toBe(true);
  expect(isConfirmedFreeModel("openrouter", "openrouter/free")).toBe(true);
  expect(isConfirmedFreeModel("openrouter", "openai/gpt-4o")).toBe(false);
  expect(isConfirmedFreeModel("groq", "llama-3.3-70b-versatile")).toBe(false);
});

test("admits the documented Gemini free-tier model family", () => {
  expect(isConfirmedFreeModel("gemini", "gemini-2.5-flash")).toBe(true);
  expect(isConfirmedFreeModel("gemini", "gemini-2.5-pro")).toBe(false);
});
