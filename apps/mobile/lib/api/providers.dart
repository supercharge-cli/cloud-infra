/// Known provider ids and stock endpoints (mirrors xibecode-core PROVIDER_CONFIGS).
class ProviderDefault {
  const ProviderDefault({
    required this.id,
    required this.baseUrl,
    this.defaultModel = '',
  });
  final String id;
  final String baseUrl;
  final String defaultModel;
}

const providerDefaults = <String, ProviderDefault>{
  'pollinations': ProviderDefault(
    id: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai/v1',
    defaultModel: 'openai',
  ),
  'openai': ProviderDefault(id: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.4'),
  'anthropic': ProviderDefault(id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6'),
  'openrouter': ProviderDefault(id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4-6'),
  'routingrun': ProviderDefault(id: 'routingrun', baseUrl: 'https://api.routing.run/v1', defaultModel: 'route/glm-5.1'),
  'zenllm': ProviderDefault(id: 'zenllm', baseUrl: 'https://api.zenllm.org/v1', defaultModel: 'zhipu/glm-5.1'),
  'nous': ProviderDefault(id: 'nous', baseUrl: 'https://inference-api.nousresearch.com/v1', defaultModel: 'deepseek/deepseek-v4-flash'),
  'hermes': ProviderDefault(id: 'hermes', baseUrl: 'https://inference-api.nousresearch.com/v1', defaultModel: 'deepseek/deepseek-v4-flash'),
  'grok': ProviderDefault(id: 'grok', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4-0709'),
  'xai': ProviderDefault(id: 'xai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4-0709'),
  'google': ProviderDefault(id: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3-pro-preview'),
  'gemini': ProviderDefault(id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-pro'),
  'deepseek': ProviderDefault(id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-pro'),
};

ProviderDefault? lookupProviderDefault(String raw) {
  final id = raw.trim().toLowerCase();
  if (id.isEmpty) return null;
  return providerDefaults[id];
}

bool urlsMatch(String a, String b) {
  String norm(String s) => s.trim().toLowerCase().replaceFirst(RegExp(r'/+$'), '');
  return norm(a) == norm(b);
}

/// True when the user must type a Base URL (custom / empty stock / non-stock override).
bool providerNeedsBaseUrl(String provider, String currentUrl) {
  final id = provider.trim().toLowerCase();
  if (id.isEmpty || id == 'custom' || id == 'auto') return true;
  final def = lookupProviderDefault(id);
  if (def == null || def.baseUrl.isEmpty) return true;
  final cur = currentUrl.trim();
  if (cur.isNotEmpty && !urlsMatch(cur, def.baseUrl)) return true;
  return false;
}

String stockBaseUrl(String provider) => lookupProviderDefault(provider)?.baseUrl ?? '';

/// Curated picker lists (mirrors xibecode-core CURATED_PROVIDER_MODELS).
const providerModels = <String, List<String>>{
  'pollinations': [
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
  'openai': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  'anthropic': [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
  ],
  'openrouter': [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-6',
    'openai/gpt-5.4',
    'google/gemini-2.5-pro',
    'deepseek/deepseek-chat-v3',
    'x-ai/grok-4',
  ],
  'routingrun': [
    'route/deepseek-v4-pro',
    'route/glm-5.1',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'glm-5.2',
    'kimi-k2.6',
  ],
  'zenllm': ['zhipu/glm-5.1', 'deepseek/deepseek-v3', 'anthropic/claude-sonnet-4'],
  'nous': ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
  'hermes': ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
  'grok': ['grok-4-0709', 'grok-3', 'grok-3-mini'],
  'xai': ['grok-4-0709', 'grok-3', 'grok-3-mini'],
  'google': ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview', 'gemini-3.5-flash'],
  'gemini': ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview'],
  'deepseek': ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
};

List<String> modelsForProvider(String provider) {
  final id = provider.trim().toLowerCase();
  return List<String>.from(providerModels[id] ?? const <String>[]);
}
