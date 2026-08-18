/// E2B public preview hosts. Vectra sandboxes serve as
/// `https://{port}-{sandboxId}.e2b.app` (legacy `.e2b.dev` still accepted).
const previewDomains = ['e2b.app', 'e2b.dev'];

final _previewRe = RegExp(
  r'https://(\d{2,5})-([A-Za-z0-9][A-Za-z0-9_-]{3,})\.(e2b\.app|e2b\.dev)(?:/[^\s)\]>]*)?',
  caseSensitive: false,
);

final _localhostRe = RegExp(
  r'https?://(?:localhost|127\.0\.0\.1)(?::(\d{2,5}))?(?:/[^\s)\]>]*)?',
  caseSensitive: false,
);

String buildPreviewUrl({
  required String sandboxId,
  required int port,
  String domain = 'e2b.app',
  String path = '',
}) {
  final id = sandboxId.trim();
  final p = port.clamp(1, 65535);
  final host = 'https://$p-$id.$domain';
  if (path.isEmpty) return host;
  return path.startsWith('/') ? '$host$path' : '$host/$path';
}

bool isPreviewUrl(String raw) => _previewRe.hasMatch(raw.trim());

List<String> extractPreviewUrls(String text) {
  return _previewRe
      .allMatches(text)
      .map((m) => m.group(0)!)
      .toSet()
      .toList();
}

/// Replace localhost / 127.0.0.1 links with the public E2B host.
String rewriteLocalhostUrls(String text, String? sandboxId, {String domain = 'e2b.app'}) {
  final id = (sandboxId ?? '').trim();
  if (id.isEmpty) return text;
  return text.replaceAllMapped(_localhostRe, (m) {
    final port = int.tryParse(m.group(1) ?? '') ?? 80;
    final raw = m.group(0)!;
    final slash = raw.indexOf('/', raw.indexOf('://') + 3);
    final path = slash >= 0 ? raw.substring(slash) : '';
    return buildPreviewUrl(sandboxId: id, port: port == 80 ? 3000 : port, domain: domain, path: path);
  });
}

int? previewPortFromUrl(String url) {
  final m = _previewRe.firstMatch(url);
  if (m == null) return null;
  return int.tryParse(m.group(1) ?? '');
}
