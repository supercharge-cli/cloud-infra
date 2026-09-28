import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

class GroupStore {
  GroupStore(this.account, this.instanceId);
  final String account;
  final String instanceId;

  Future<File> _file() async {
    final root = await getApplicationDocumentsDirectory();
    final owner = base64Url.encode(utf8.encode(account)).replaceAll('=', '');
    final id = base64Url.encode(utf8.encode(instanceId)).replaceAll('=', '');
    return File('${root.path}/vectra-groups/$owner/$id.json');
  }

  Future<Map<String, dynamic>> load() async {
    try {
      final value = jsonDecode(await (await _file()).readAsString());
      return value is Map<String, dynamic> ? value : {};
    } catch (_) {
      return {};
    }
  }

  Future<void> save(List<Map<String, dynamic>> messages, String draft) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.next');
    await temporary.writeAsString(
      jsonEncode({'messages': messages, 'draft': draft}),
      flush: true,
    );
    await temporary.rename(file.path);
  }
}
