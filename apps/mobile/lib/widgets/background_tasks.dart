import 'package:flutter/material.dart';

import '../theme.dart';

class BackgroundTasksBar extends StatelessWidget {
  const BackgroundTasksBar({super.key, required this.tasks});
  final List<Map<String, dynamic>> tasks;

  @override
  Widget build(BuildContext context) {
    if (tasks.isEmpty) return const SizedBox.shrink();
    return Material(
      color: Vc.card,
      child: ExpansionTile(
        leading: const Icon(Icons.dns_outlined, color: Vc.green, size: 20),
        title: Text('${tasks.length} background task${tasks.length == 1 ? '' : 's'} running'),
        subtitle: const Text('Running in E2B · you can keep chatting'),
        children: [
          for (final task in tasks)
            ListTile(
              dense: true,
              leading: const Icon(Icons.terminal, size: 18),
              title: Text('${task['title'] ?? task['command'] ?? 'Background task'}', maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: task['command'] == null ? null : Text('${task['command']}', maxLines: 2, overflow: TextOverflow.ellipsis),
            ),
        ],
      ),
    );
  }
}
