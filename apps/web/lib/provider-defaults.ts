/** Stock endpoints for known API types (mirrors xibecode-core PROVIDER_CONFIGS). */
export const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel?: string }> = {
  pollinations: { baseUrl: 'https://gen.pollinations.ai/v1', defaultModel: 'openai' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.4' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4-6' },
  routingrun: { baseUrl: 'https://api.routing.run/v1', defaultModel: 'route/glm-5.1' },
  zenllm: { baseUrl: 'https://api.zenllm.org/v1', defaultModel: 'zhipu/glm-5.1' },
  nous: { baseUrl: 'https://inference-api.nousresearch.com/v1', defaultModel: 'deepseek/deepseek-v4-flash' },
  hermes: { baseUrl: 'https://inference-api.nousresearch.com/v1', defaultModel: 'deepseek/deepseek-v4-flash' },
  grok: { baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4-0709' },
  xai: { baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4-0709' },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3-pro-preview',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
  },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-pro' },
};

function normUrl(s: string): string {
  return s.trim().toLowerCase().replace(/\/+$/, '');
}

export function lookupProviderDefault(provider: string) {
  return PROVIDER_DEFAULTS[provider.trim().toLowerCase()] ?? null;
}

export function providerNeedsBaseUrl(provider: string, currentUrl: string): boolean {
  const id = provider.trim().toLowerCase();
  if (!id || id === 'custom' || id === 'auto') return true;
  const def = lookupProviderDefault(id);
  if (!def?.baseUrl) return true;
  const cur = currentUrl.trim();
  if (cur && normUrl(cur) !== normUrl(def.baseUrl)) return true;
  return false;
}

export function stockBaseUrl(provider: string): string {
  return lookupProviderDefault(provider)?.baseUrl || '';
}

/** Curated picker lists (mirrors xibecode-core CURATED_PROVIDER_MODELS). */
export const PROVIDER_MODELS: Record<string, string[]> = {
  pollinations: [
    'openai',
    'openai-fast',
    'qwen3.7-flash',
    'qwen-coder',
    'gemini-fast',
    'claude-fast',
    'deepseek',
    'kimi-code',
    'inkling',
    'nemotron',
  ],
  openai: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  anthropic: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
  ],
  openrouter: [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-6',
    'openai/gpt-5.4',
    'google/gemini-2.5-pro',
    'deepseek/deepseek-chat-v3',
    'x-ai/grok-4',
  ],
  routingrun: [
    'route/deepseek-v4-pro',
    'route/glm-5.1',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'glm-5.2',
    'kimi-k2.6',
  ],
  zenllm: ['zhipu/glm-5.1', 'deepseek/deepseek-v3', 'anthropic/claude-sonnet-4'],
  nous: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
  hermes: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
  grok: ['grok-4-0709', 'grok-3', 'grok-3-mini'],
  xai: ['grok-4-0709', 'grok-3', 'grok-3-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview', 'gemini-3.5-flash'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
};

export function modelsForProvider(provider: string): string[] {
  return [...(PROVIDER_MODELS[provider.trim().toLowerCase()] || [])];
}

/** Friendly labels for known catalog ids (picker shows name, stores id). */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  openai: "GPT",
  "openai-fast": "GPT Fast",
  "openai-large": "GPT Large",
  "qwen3.7-flash": "Qwen 3.7 Flash",
  "qwen-coder": "Qwen Coder",
  "gemini-fast": "Gemini Fast",
  "claude-fast": "Claude Fast",
  deepseek: "DeepSeek",
  "kimi-code": "Kimi Code",
  inkling: "Inkling",
  nemotron: "Nemotron",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5-mini": "GPT-5 Mini",
  "gpt-4.1": "GPT-4.1",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "anthropic/claude-sonnet-4-6": "Claude Sonnet 4.6",
  "anthropic/claude-opus-4-6": "Claude Opus 4.6",
  "openai/gpt-5.4": "GPT-5.4",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "deepseek/deepseek-chat-v3": "DeepSeek Chat V3",
  "x-ai/grok-4": "Grok 4",
  "route/deepseek-v4-pro": "DeepSeek V4 Pro (route)",
  "route/glm-5.1": "GLM 5.1 (route)",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "glm-5.2": "GLM 5.2",
  "kimi-k2.6": "Kimi K2.6",
  "zhipu/glm-5.1": "GLM 5.1",
  "deepseek/deepseek-v3": "DeepSeek V3",
  "anthropic/claude-sonnet-4": "Claude Sonnet 4",
  "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
  "grok-4-0709": "Grok 4",
  "grok-3": "Grok 3",
  "grok-3-mini": "Grok 3 Mini",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-3-pro-preview": "Gemini 3 Pro",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
};

export type CatalogModel = {
  id: string;
  name: string;
};

export function prettyModelName(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  const known = MODEL_DISPLAY_NAMES[trimmed] || MODEL_DISPLAY_NAMES[trimmed.toLowerCase()];
  if (known) return known;
  const last = trimmed.split("/").pop() || trimmed;
  return last
    .replace(/[._]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

export function catalogModel(id: string, name?: string | null): CatalogModel | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const label = (name || "").trim();
  return {
    id: trimmed,
    name: label && label !== trimmed ? label : prettyModelName(trimmed),
  };
}

export function modelsForProviderDetailed(provider: string): CatalogModel[] {
  return modelsForProvider(provider)
    .map((id) => catalogModel(id))
    .filter((m): m is CatalogModel => Boolean(m));
}

export function parseCatalogModels(raw: unknown): CatalogModel[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
      ? ((raw as { models: unknown[] }).models)
      : [];
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const item of list) {
    let parsed: CatalogModel | null = null;
    if (typeof item === "string") {
      parsed = catalogModel(item);
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const id = String(rec.id ?? rec.model ?? rec.modelId ?? rec.name ?? "").trim();
      const name = String(rec.title ?? rec.displayName ?? rec.name ?? "").trim();
      parsed = catalogModel(id, name === id ? undefined : name);
    }
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

export function mergeCatalogModels(...groups: CatalogModel[][]): CatalogModel[] {
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const group of groups) {
    for (const model of group) {
      if (!model.id || seen.has(model.id)) continue;
      seen.add(model.id);
      out.push(model);
    }
  }
  return out;
}
