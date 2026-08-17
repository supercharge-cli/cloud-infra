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
