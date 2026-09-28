Map<String, String> noVncSettings({
  required String websocketUrl,
  bool controlling = false,
}) => {
  'path': websocketUrl,
  'autoconnect': '1',
  'reconnect': '1',
  'reconnect_delay': '2000',
  'resize': 'scale',
  'view_only': controlling ? '0' : '1',
  'bell': '0',
};

Uri embeddedNoVncUrl(
  Uri page, {
  required String websocketUrl,
  bool controlling = false,
}) => page.replace(
  fragment: Uri(
    queryParameters: noVncSettings(
      websocketUrl: websocketUrl,
      controlling: controlling,
    ),
  ).query,
);

Uri e2bNoVncUrl(
  String sandboxId, {
  String domain = 'e2b.app',
  bool controlling = false,
}) {
  if (!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(sandboxId) ||
      !{'e2b.app', 'e2b.dev'}.contains(domain)) {
    throw const FormatException('Invalid E2B desktop address');
  }
  final host = '6080-$sandboxId.$domain';
  return embeddedNoVncUrl(
    Uri.https(host, '/vnc.html'),
    websocketUrl: 'wss://$host/websockify',
    controlling: controlling,
  );
}
