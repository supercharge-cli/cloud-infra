import 'dart:io';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../chat/draft.dart';
import '../theme.dart';

class ChatImageBubble extends StatelessWidget {
  const ChatImageBubble({
    super.key,
    required this.event,
    required this.onOpen,
    required this.onSave,
    required this.onShare,
    this.downloading = false,
    this.onRetry,
  });

  final AppChatEvent event;
  final VoidCallback onOpen;
  final VoidCallback onSave;
  final VoidCallback onShare;
  final bool downloading;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final path = event.localPath;
    final mine = event.isUser;
    final image = path != null && File(path).existsSync()
        ? Image.file(File(path), fit: BoxFit.cover, width: 240, height: 240)
        : null;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.fromLTRB(mine ? 56 : 12, 5, mine ? 12 : 56, 5),
        decoration: BoxDecoration(
          color: mine ? Vc.greenDim : Vc.card,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 5),
            bottomRight: Radius.circular(mine ? 5 : 16),
          ),
          border: mine ? null : Border.all(color: Vc.cardBorder),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            GestureDetector(
              onTap: image != null ? onOpen : onRetry,
              child: SizedBox(
                width: 240,
                height: 180,
                child: image ??
                    ColoredBox(
                        color: const Color(0xFF18181B),
                        child: Center(
                          child: downloading
                              ? const CircularProgressIndicator(color: Vc.green, strokeWidth: 2)
                              : IconButton(
                                  onPressed: onRetry,
                                  icon: const Icon(Icons.broken_image_outlined, color: Vc.muted),
                                ),
                        ),
                      ),
              ),
            ),
            if (event.text.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
                child: Text(event.text, style: const TextStyle(fontSize: 13)),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton.icon(
                    onPressed: image != null ? onSave : onRetry,
                    icon: const Icon(Icons.save_alt, size: 16),
                    label: Text(image != null ? 'Save' : 'Load'),
                  ),
                  TextButton.icon(
                    onPressed: image != null ? onShare : null,
                    icon: const Icon(Icons.share_outlined, size: 16),
                    label: const Text('Share'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ChatFileCard extends StatelessWidget {
  const ChatFileCard({
    super.key,
    required this.event,
    required this.onDownload,
    required this.onShare,
    this.downloading = false,
  });

  final AppChatEvent event;
  final VoidCallback onDownload;
  final VoidCallback onShare;
  final bool downloading;

  @override
  Widget build(BuildContext context) {
    final mine = event.isUser;
    final ready = event.localPath != null && File(event.localPath!).existsSync();
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.fromLTRB(mine ? 56 : 12, 5, mine ? 12 : 56, 5),
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 8),
        decoration: BoxDecoration(
          color: mine ? Vc.greenDim : Vc.card,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 5),
            bottomRight: Radius.circular(mine ? 5 : 16),
          ),
          border: mine ? null : Border.all(color: Vc.cardBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  event.isImage ? Icons.image : Icons.insert_drive_file_outlined,
                  color: Vc.green,
                  size: 22,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(event.name ?? 'file', maxLines: 2, overflow: TextOverflow.ellipsis),
                      Text(
                        [
                          if (event.kind != null) event.kind!,
                          if (event.size != null) _fmtSize(event.size!),
                        ].join(' · '),
                        style: const TextStyle(color: Vc.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (event.text.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(event.text, style: const TextStyle(fontSize: 13)),
              ),
            Row(
              children: [
                TextButton.icon(
                  onPressed: downloading ? null : onDownload,
                  icon: downloading
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Vc.green),
                        )
                      : Icon(ready ? Icons.download_done : Icons.download, size: 16),
                  label: Text(ready ? 'Saved' : 'Download'),
                ),
                TextButton.icon(
                  onPressed: ready ? onShare : null,
                  icon: const Icon(Icons.share_outlined, size: 16),
                  label: const Text('Share'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class ImageLightbox extends StatelessWidget {
  const ImageLightbox({
    super.key,
    required this.path,
    required this.title,
    required this.onSave,
    required this.onShare,
  });
  final String path;
  final String title;
  final VoidCallback onSave;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: Text(title, style: const TextStyle(fontSize: 14)),
        actions: [
          IconButton(onPressed: onSave, icon: const Icon(Icons.save_alt)),
          IconButton(onPressed: onShare, icon: const Icon(Icons.share_outlined)),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 5,
          child: Image.file(File(path)),
        ),
      ),
    );
  }
}

class DraftTray extends StatelessWidget {
  const DraftTray({super.key, required this.items, required this.onRemove});
  final List<DraftAttach> items;
  final ValueChanged<DraftAttach> onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 88,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) {
          final f = items[i];
          return SizedBox(
            width: 72,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFF18181B),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Vc.cardBorder),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: f.isImage && f.path != null && File(f.path!).existsSync()
                          ? Image.file(File(f.path!), fit: BoxFit.cover)
                          : f.isImage
                              ? Image.memory(f.bytes, fit: BoxFit.cover)
                              : Padding(
                                  padding: const EdgeInsets.all(6),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Icon(Icons.insert_drive_file_outlined, color: Vc.green, size: 22),
                                      const SizedBox(height: 4),
                                      Text(
                                        f.name,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(fontSize: 9, color: Vc.muted),
                                      ),
                                    ],
                                  ),
                                ),
                    ),
                  ),
                ),
                Positioned(
                  top: -6,
                  right: -6,
                  child: GestureDetector(
                    onTap: () => onRemove(f),
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: const BoxDecoration(color: Color(0xFF27272A), shape: BoxShape.circle),
                      child: const Icon(Icons.close, size: 14, color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

String _fmtSize(int n) {
  if (n < 1024) return '$n B';
  if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(1)} KB';
  return '${(n / (1024 * 1024)).toStringAsFixed(1)} MB';
}