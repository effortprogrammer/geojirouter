const EXACT_FREE_MODELS: Readonly<Record<string, readonly string[]>> = {
  sambanova: ["DeepSeek-V3.1", "Meta-Llama-3.3-70B-Instruct", "gpt-oss-120b"],
  cloudflare: ["@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"],
};

export function isConfirmedFreeModel(provider: string, model: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === "openrouter") {
    return model === "openrouter/free" || model.endsWith(":free");
  }
  if (normalizedProvider === "gemini") {
    return model === "gemini-2.5-flash" || model === "gemini-2.5-flash-lite";
  }
  return EXACT_FREE_MODELS[normalizedProvider]?.includes(model) ?? false;
}
