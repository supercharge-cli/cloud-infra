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
