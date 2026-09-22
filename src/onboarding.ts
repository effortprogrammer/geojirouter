import { mkdirSync } from "node:fs";
import { loadCatalog } from "./catalog";

export type AsideRunner = (args: readonly string[]) => Promise<string>;

export type OnboardingResult = {
  readonly status: "needs_user_action";
  readonly completed: false;
  readonly provider: string;
  readonly signupUrl: string;
  readonly checkpoint: "login" | "verification" | "terms" | "captcha" | "unknown";
  readonly screenshotPath: string;
  readonly transcript: string;
};

type OnboardingOptions = {
  readonly runAside: AsideRunner;
};

function checkpoint(text: string): OnboardingResult["checkpoint"] {
  const normalized = text.toLowerCase();
  if (normalized.includes("captcha")) return "captcha";
  if (normalized.includes("term")) return "terms";
  if (normalized.includes("verif")) return "verification";
  if (normalized.includes("login") || normalized.includes("sign in")) return "login";
  return "unknown";
}

function redact(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [redacted]")
    .replace(/(?:sk|key|token)[-_a-z0-9]{8,}/gi, "[redacted]");
}

async function defaultAsideRunner(args: readonly string[]): Promise<string> {
  const process = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Aside exited with ${exitCode}: ${redact(stderr).slice(0, 300)}`);
  }
  return redact(`${stdout}\n${stderr}`).slice(0, 1000);
}

export async function onboardProvider(
  providerId: string,
  options?: Partial<OnboardingOptions>,
): Promise<OnboardingResult> {
  const provider = loadCatalog().find((candidate) => candidate.id === providerId);
  if (provider === undefined) throw new Error(`Unknown provider: ${providerId}`);
  const runAside = options?.runAside ?? defaultAsideRunner;
  const code = [
    `const tab = await openTab(${JSON.stringify(provider.signupUrl)});`,
    "try {",
    "  console.log((await snapshot(tab)).tree);",
    `  await tab.screenshot({ path: './artifacts/everyone-gateway-${providerId}.png' });`,
    `  console.log('EVERYONE_GATEWAY_SCREENSHOT=./artifacts/everyone-gateway-${providerId}.png');`,
    "} finally {",
    "  await closeTab(tab);",
    "  console.log('EVERYONE_GATEWAY_TAB_CLOSED');",
    "}",
  ].join(" ");
  mkdirSync("./artifacts", { recursive: true });
  const transcript = redact(await runAside(["aside", "repl", code]));
  return {
    status: "needs_user_action",
    completed: false,
    provider: providerId,
    signupUrl: provider.signupUrl,
    checkpoint: checkpoint(transcript),
    screenshotPath: `./artifacts/everyone-gateway-${providerId}.png`,
    transcript,
  };
}
