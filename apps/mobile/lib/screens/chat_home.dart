import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import 'chat.dart';
import 'instances.dart';

class ChatHomeScreen extends StatefulWidget {
  const ChatHomeScreen({super.key});

  @override
  State<ChatHomeScreen> createState() => _ChatHomeScreenState();
}

class _ChatHomeScreenState extends State<ChatHomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(
          context.read<SessionController>().workspaces.refresh(force: false),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final catalog = context.read<SessionController>().workspaces;
    return ListenableBuilder(
      listenable: catalog,
      builder: (context, _) {
        final items = catalog.items
            .where((item) => item.status != 'destroyed')
            .toList();
        if (items.isNotEmpty) {
          final instance =
              items
                  .where((item) => item.runtime == AgentRuntime.supercharge)
                  .firstOrNull ??
              items.first;
          return ChatScreen(
            key: ValueKey('chat-${instance.id}'),
            instanceId: instance.id,
            instance: instance,
            showGroup: instance.runtime == AgentRuntime.supercharge,
          );
        }
        if (catalog.initialized) return const InstancesScreen();
        return AppScaffold(
          isRoot: true,
          appBar: AppBar(title: const Text('Chats')),
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.forum_outlined, size: 36, color: Vc.greenSoft),
                const SizedBox(height: 18),
                Text(
                  catalog.error ?? 'Opening your chats…',
                  style: const TextStyle(color: Vc.muted),
                ),
                if (catalog.error != null)
                  TextButton(
                    onPressed: () => catalog.refresh(),
                    child: const Text('Retry'),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
