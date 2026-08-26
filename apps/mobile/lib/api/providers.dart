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

class CatalogModel {
  const CatalogModel({required this.id, required this.name});
  final String id;
  final String name;

  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return name.toLowerCase().contains(q) || id.toLowerCase().contains(q);
  }
}

const modelDisplayNames = <String, String>{
  'openai': 'GPT',
  'openai-fast': 'GPT Fast',
  'openai-large': 'GPT Large',
  'qwen3.7-flash': 'Qwen 3.7 Flash',
  'qwen-coder': 'Qwen Coder',
  'gemini-fast': 'Gemini Fast',
  'claude-fast': 'Claude Fast',
  'deepseek': 'DeepSeek',
  'kimi-code': 'Kimi Code',
  'inkling': 'Inkling',
  'nemotron': 'Nemotron',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'grok-4-0709': 'Grok 4',
  'grok-3': 'Grok 3',
  'grok-3-mini': 'Grok 3 Mini',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
};

String prettyModelName(String id) {
  final trimmed = id.trim();
  if (trimmed.isEmpty) return '';
  final known = modelDisplayNames[trimmed] ?? modelDisplayNames[trimmed.toLowerCase()];
  if (known != null) return known;
  final last = trimmed.contains('/') ? trimmed.split('/').last : trimmed;
  return last.replaceAll(RegExp(r'[._-]+'), ' ').split(' ').where((w) => w.isNotEmpty).map((w) {
    return '${w[0].toUpperCase()}${w.length > 1 ? w.substring(1) : ''}';
  }).join(' ');
}

CatalogModel catalogModel(String id, [String? name]) {
  final trimmed = id.trim();
  final label = (name ?? '').trim();
  return CatalogModel(
    id: trimmed,
    name: label.isNotEmpty && label != trimmed ? label : prettyModelName(trimmed),
  );
}

List<CatalogModel> modelsForProviderDetailed(String provider) {
  return modelsForProvider(provider).map(catalogModel).toList();
}

List<CatalogModel> parseCatalogModels(dynamic raw) {
  final list = raw is List ? raw : const [];
  final seen = <String>{};
  final out = <CatalogModel>[];
  for (final item in list) {
    CatalogModel? parsed;
    if (item is String) {
      parsed = catalogModel(item);
    } else if (item is Map) {
      final id = '${item['id'] ?? item['model'] ?? item['modelId'] ?? item['name'] ?? ''}'.trim();
      final name = '${item['title'] ?? item['displayName'] ?? item['name'] ?? ''}'.trim();
      if (id.isNotEmpty) parsed = catalogModel(id, name == id ? null : name);
    }
    if (parsed == null || parsed.id.isEmpty || seen.contains(parsed.id)) continue;
    seen.add(parsed.id);
    out.add(parsed);
  }
  return out;
}

List<CatalogModel> mergeCatalogModels(List<List<CatalogModel>> groups) {
  final seen = <String>{};
  final out = <CatalogModel>[];
  for (final group in groups) {
    for (final model in group) {
      if (model.id.isEmpty || seen.contains(model.id)) continue;
      seen.add(model.id);
      out.add(model);
    }
  }
  return out;
}
