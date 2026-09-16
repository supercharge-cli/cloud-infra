import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../theme.dart';
import 'notifications.dart';

class CliVersion {
  CliVersion({
    required this.current,
    required this.latest,
    required this.updateAvailable,
    this.runtime = 'xibecode',
  });

  final String current;
  final String latest;
  final bool updateAvailable;
  final String runtime;

  bool get isSupercharge => runtime == 'supercharge';
  String get product => isSupercharge ? 'Supercharge' : 'XibeCode';

  factory CliVersion.fromJson(Map<String, dynamic>? j, {String? runtime}) {
    if (j == null) {
      return CliVersion(current: '', latest: '', updateAvailable: false, runtime: runtime ?? 'xibecode');
    }
    final current = '${j['current'] ?? ''}';
    final latest = '${j['latest'] ?? ''}';
    final raw = (runtime ?? '${j['runtime'] ?? j['kind'] ?? 'xibecode'}').toLowerCase();
    final newer = _isNewer(latest, current);
    return CliVersion(
      current: current,
      latest: latest,
      runtime: raw.contains('supercharge') ? 'supercharge' : 'xibecode',
      updateAvailable: newer && (j['updateAvailable'] != false),
    );
  }

  static final _semver = RegExp(r'(\d+)\.(\d+)\.(\d+)');

  static String? _core(String raw) {
    final m = _semver.firstMatch(raw.trim().replaceFirst(RegExp(r'^v', caseSensitive: false), ''));
    if (m == null) return null;
    return '${m[1]}.${m[2]}.${m[3]}';
  }

  static bool _isNewer(String latest, String current) {
    final a = _core(latest);
    final b = _core(current);
    if (a == null || b == null) return false;
    final av = a.split('.').map(int.parse).toList();
    final bv = b.split('.').map(int.parse).toList();
    for (var i = 0; i < 3; i++) {
      if (av[i] != bv[i]) return av[i] > bv[i];
    }
    return false;
  }
}

class CliUpdateOffer {
  static const _store = FlutterSecureStorage();

  static String _dismissKey(String instanceId) => 'cli-update-dismiss:$instanceId';
  static String _notifiedKey(String instanceId) => 'cli-update-notified:$instanceId';

  static Future<bool> isDismissed(String instanceId, String latest) async {
    if (latest.isEmpty) return false;
    return (await _store.read(key: _dismissKey(instanceId))) == latest;
  }

  static Future<void> dismiss(String instanceId, String latest) async {
    if (latest.isEmpty) return;
    await _store.write(key: _dismissKey(instanceId), value: latest);
  }

  static Future<void> notifyOnce({
    required String instanceId,
    required String name,
    required CliVersion info,
  }) async {
    if (!info.updateAvailable || info.latest.isEmpty) return;
    final already = await _store.read(key: _notifiedKey(instanceId));
    if (already == info.latest) return;
    await _store.write(key: _notifiedKey(instanceId), value: info.latest);
    await TaskNotifications.showCliUpdate(
      instanceId: instanceId,
      name: name,
      current: info.current,
      latest: info.latest,
      product: info.product,
    );
  }
}

class CliUpdateNote extends StatelessWidget {
  const CliUpdateNote({
    super.key,
    required this.info,
    required this.onUpdate,
    this.onDismiss,
    this.busy = false,
  });

  final CliVersion info;
  final VoidCallback onUpdate;
  final VoidCallback? onDismiss;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF1C1917),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
        child: Row(
          children: [
            const Icon(Icons.system_update_alt, color: Vc.amber, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'New ${info.product} CLI',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  Text(
                    '${info.current.isEmpty ? '?' : info.current} → ${info.latest}',
                    style: const TextStyle(color: Vc.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: busy ? null : onUpdate,
              child: busy
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Vc.green),
                    )
                  : const Text('Update'),
            ),
            if (onDismiss != null)
              IconButton(
                tooltip: 'Later',
                onPressed: onDismiss,
                icon: const Icon(Icons.close, size: 18, color: Vc.muted),
              ),
          ],
        ),
      ),
    );
  }
}
