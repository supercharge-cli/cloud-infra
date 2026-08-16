import 'dart:typed_data';

import '../api/models.dart';

class DraftAttach {
  DraftAttach({
    required this.id,
    required this.name,
    required this.bytes,
    this.path,
    this.mime,
    this.kind,
  });

  final String id;
  final String name;
  final Uint8List bytes;
  final String? path;
  final String? mime;
  final String? kind;

  bool get isImage => looksLikeImage(name: name, mime: mime, kind: kind);
  int get size => bytes.length;
}