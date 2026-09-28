import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/state/workspaces.dart';

class CatalogClient extends VectraClient {
  CatalogClient() : super(baseUrl: 'https://example.invalid');
  final requests = <Completer<DashboardData>>[];
  final deletes = <Completer<void>>[];

  @override
  Future<DashboardData> dashboard() {
    final completer = Completer<DashboardData>();
    requests.add(completer);
    return completer.future;
  }

  @override
  Future<void> destroy(String id) {
    final completer = Completer<void>();
    deletes.add(completer);
    return completer.future;
  }
}

DashboardData listed([String id = 'alpha']) => DashboardData(
  instances: [CloudInstance(id: id, name: id, status: 'running')],
  quota: FreeQuota(limit: 2, used: 1, available: 1),
);

void main() {
  test('destroy removes from both observers immediately and ignores an old list response', () async {
    final client = CatalogClient();
    final catalog = WorkspaceCatalog(() => client);
    final first = catalog.refresh();
    client.requests.last.complete(listed());
    await first;
    expect(catalog.items.single.id, 'alpha');
    final stale = catalog.refresh();
    final deletion = catalog.destroy('alpha');
    expect(catalog.items, isEmpty);
    client.requests[1].complete(listed());
    await stale;
    expect(catalog.items, isEmpty);
    client.deletes.single.complete();
    await deletion;
    client.requests.last.complete(DashboardData(instances: [], quota: FreeQuota()));
    await Future<void>.delayed(Duration.zero);
    expect(catalog.items, isEmpty);
    catalog.dispose();
  });

  test('failed destroy restores the workspace and a later refresh cannot resurrect it after success', () async {
    final client = CatalogClient();
    final catalog = WorkspaceCatalog(() => client);
    final initial = catalog.refresh();
    client.requests.single.complete(listed());
    await initial;
    final failed = catalog.destroy('alpha');
    expect(catalog.items, isEmpty);
    client.deletes.single.completeError(StateError('failed'));
    await expectLater(failed, throwsStateError);
    expect(catalog.items.single.id, 'alpha');
    final next = catalog.destroy('alpha');
    client.deletes.last.complete();
    await next;
    client.requests.last.complete(listed());
    await Future<void>.delayed(Duration.zero);
    expect(catalog.items, isEmpty);
    catalog.dispose();
  });

  test('reset discards in-flight data from a prior account', () async {
    final client = CatalogClient();
    final catalog = WorkspaceCatalog(() => client);
    final fetch = catalog.refresh();
    catalog.reset();
    client.requests.single.complete(listed());
    await fetch;
    expect(catalog.items, isEmpty);
    catalog.dispose();
  });
}
