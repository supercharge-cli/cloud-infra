import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../theme.dart';
import 'notifications.dart';

class CliVersion {
  CliVersion({
    required this.current,
    required this.latest,
    required this.updateAvailable,
  });

  final String current;
  final String latest;
  final bool updateAvailable;

  factory CliVersion.fromJson(Map<String, dynamic>? j) {
    if (j == null) return CliVersion(current: '', latest: '', updateAvailable: false);
    return CliVersion(
      current: '${j['current'] ?? ''}',
      latest: '${j['latest'] ?? ''}',
      updateAvailable: j['updateAvailable'] == true,
    );
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
                  const Text(
                    'New XibeCode CLI',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
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
