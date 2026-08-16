import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/session.dart';

class InstancesScreen extends StatefulWidget {
  const InstancesScreen({super.key});
  @override
  State<InstancesScreen> createState() => _InstancesScreenState();
}

class _InstancesScreenState extends State<InstancesScreen> {
  List<CloudInstance> items = [];
  bool loading = true;
  String? error;

  VectraClient get api => context.read<SessionController>().client;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      items = await api.instances();
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _create() async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: 'workspace');
        return AlertDialog(
          title: const Text('New instance'),
          content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Name')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Create')),
          ],
        );
      },
    );
    if (name == null || name.isEmpty) return;
    try {
      await api.createInstance(name);
      await _reload();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Instances'),
        actions: [
          IconButton(onPressed: () => context.push('/account'), icon: const Icon(Icons.person)),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _create,
        child: const Icon(Icons.add),
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: loading
            ? ListView(children: const [SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))])
            : error != null
                ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(error!))])
                : items.isEmpty
                    ? ListView(children: const [
                        Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('No instances yet. Tap + to create a free one, then open Chat.'),
                        ),
                      ])
                    : ListView.builder(
                        itemCount: items.length,
                        itemBuilder: (ctx, i) {
                          final inst = items[i];
                          return ListTile(
                            title: Text(inst.name),
                            subtitle: Text('${inst.displayState}${inst.isFree ? ' · free' : ''}'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => context.push('/chat/${inst.id}', extra: inst),
                            onLongPress: () => context.push('/instance/${inst.id}', extra: inst),
                          );
                        },
                      ),
      ),
    );
  }
}
