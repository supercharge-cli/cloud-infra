import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

class DesktopNative {
  static const channel = MethodChannel('in.xibeai.vectra_cloud/desktop');
  static void Function(List<String>)? onFilesDropped;

  static void initialize() {
    if (!Platform.isLinux) return;
    channel.setMethodCallHandler((call) async {
      if (call.method == 'filesDropped') {
        onFilesDropped?.call(
          (call.arguments as List).whereType<String>().toList(),
        );
      }
    });
  }

  static Future<Uint8List?> clipboardImage() async => Platform.isLinux
      ? channel.invokeMethod<Uint8List>('clipboardImage')
      : null;

  static Future<void> toggleFullscreen() async {
    if (Platform.isLinux) await channel.invokeMethod<void>('fullscreen');
  }

  static Future<void> focusWindow() async {
    if (Platform.isLinux) await channel.invokeMethod<void>('focus');
  }

  static const previewSurface = 'preview';
  static const viewerSurface = 'ai-viewer';

  static Future<void> inlineLoad(String id, String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty) {
      throw const FormatException('Enter an HTTP or HTTPS URL.');
    }
    if (id == viewerSurface &&
        (uri.scheme != 'http' || uri.host != '127.0.0.1' || !uri.hasPort)) {
      throw const FormatException(
        'The AI viewer must use its local capability URL.',
      );
    }
    if (Platform.isLinux) {
      await channel.invokeMethod<void>('inlineLoad', {'id': id, 'url': url});
    }
  }

  static Future<void> inlineShow(
    String id,
    Rect logicalBounds,
    double pixelRatio,
  ) async {
    if (!Platform.isLinux) return;
    await channel.invokeMethod<void>('inlineShow', {
      'id': id,
      'x': logicalBounds.left,
      'y': logicalBounds.top,
      'width': logicalBounds.width,
      'height': logicalBounds.height,
      'pixelRatio': pixelRatio,
    });
  }

  static Future<void> inlineHide(String id) async {
    if (Platform.isLinux) {
      await channel.invokeMethod<void>('inlineHide', {'id': id});
    }
  }

  static Future<void> inlineDispose(String id) async {
    if (Platform.isLinux) {
      await channel.invokeMethod<void>('inlineDispose', {'id': id});
    }
  }

  static Future<void> inlineCommand(String id, String command) async {
    if (Platform.isLinux) {
      await channel.invokeMethod<void>('inlineCommand', {
        'id': id,
        'command': command,
      });
    }
  }

  static Future<Map<String, dynamic>?> checkout(
    Map<String, dynamic> options,
  ) async {
    if (!Platform.isLinux) {
      throw UnsupportedError('Native checkout is available on Linux.');
    }
    final result = await channel.invokeMapMethod<String, dynamic>(
      'checkout',
      options,
    );
    return result;
  }

  static Future<void> openFile(String path) async {
    if (!await launchUrl(
      Uri.file(path),
      mode: LaunchMode.externalApplication,
    )) {
      throw StateError('No application could open this file.');
    }
  }

  static String fileName(String name) {
    final base = name
        .replaceAll('\\', '/')
        .split('/')
        .last
        .replaceAll(RegExp(r'[\x00-\x1f]'), '_');
    return base.isEmpty || base == '.' || base == '..' ? 'download' : base;
  }

  static Future<Uri?> saveBytes(Uint8List bytes, String name, {String? mime}) =>
      FilePicker.saveFile(
        fileName: fileName(name),
        bytes: bytes,
        mimeType: mime ?? 'application/octet-stream',
        dialogTitle: 'Save ${fileName(name)}',
      );

  static Future<Uri?> saveFile(
    String path,
    String name, {
    String? mime,
  }) async => saveBytes(await File(path).readAsBytes(), name, mime: mime);
}
