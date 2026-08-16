export type SavedProvider = {
  id: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  format?: 'openai' | 'anthropic';
  label?: string;
};

export function savedProviderId(provider: string, baseUrl?: string): string {
  const p = (provider || 'custom').trim().toLowerCase() || 'custom';
  if (p === 'custom' || p === 'auto') {
    try {
      const host = baseUrl ? new URL(baseUrl).host : '';
      return host ? `custom:${host}` : 'custom';
    } catch {
      return 'custom';
    }
  }
  return p;
}

export function parseSavedProviders(raw: unknown): SavedProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedProvider[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const provider = String(rec.provider || rec.id || '').trim();
    if (!provider) continue;
    const baseUrl = rec.baseUrl != null ? String(rec.baseUrl).trim() : undefined;
    const id = String(rec.id || '').trim() || savedProviderId(provider, baseUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    const apiKey = rec.apiKey != null ? String(rec.apiKey).trim() : undefined;
    out.push({
      id,
      provider,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      model: rec.model != null ? String(rec.model).trim() || undefined : undefined,
      format: rec.format === 'anthropic' ? 'anthropic' : rec.format === 'openai' ? 'openai' : undefined,
      label: rec.label != null ? String(rec.label).trim() || undefined : undefined,
    });
  }
  return out;
}

export function upsertSavedProvider(list: SavedProvider[], slot: SavedProvider): SavedProvider[] {
  const id = slot.id || savedProviderId(slot.provider, slot.baseUrl);
  const next = { ...slot, id };
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return [...list, next];
  const prev = list[idx]!;
  return list.map((s, i) =>
    i === idx
      ? {
          ...prev,
          ...next,
          apiKey: next.apiKey || prev.apiKey,
          baseUrl: next.baseUrl ?? prev.baseUrl,
          model: next.model ?? prev.model,
          format: next.format ?? prev.format,
          label: next.label ?? prev.label,
        }
      : s,
  );
}

export function slotFromActive(input: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): SavedProvider | null {
  const provider = (input.provider || '').trim() || (input.baseUrl?.trim() ? 'custom' : '');
  if (!provider && !input.apiKey?.trim()) return null;
  return {
    id: savedProviderId(provider || 'custom', input.baseUrl),
    provider: provider || 'custom',
    apiKey: input.apiKey?.trim() || undefined,
    baseUrl: input.baseUrl?.trim() || undefined,
    model: input.model?.trim() || undefined,
  };
}

export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  nous: ['NOUS_API_KEY', 'HERMES_API_KEY'],
  hermes: ['HERMES_API_KEY', 'NOUS_API_KEY'],
  routingrun: ['ROUTINGRUN_API_KEY'],
  zenllm: ['ZENLLM_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  grok: ['XAI_API_KEY'],
  xai: ['XAI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  zai: ['ZAI_API_KEY', 'GLM_API_KEY'],
  kimi: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
  lmstudio: ['LM_API_KEY'],
  'azure-foundry': ['AZURE_FOUNDRY_API_KEY'],
};

export function envKeysForProvider(provider: string): string[] {
  return PROVIDER_ENV_KEYS[provider.trim().toLowerCase()] || [];
}
