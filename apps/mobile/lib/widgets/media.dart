import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../chat/draft.dart';
import '../files/kinds.dart';
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
    final url = event.url;
    final mine = event.isUser;
    Widget image;
    if (path != null && File(path).existsSync()) {
      image = Image.file(File(path), fit: BoxFit.cover, width: 240, height: 240);
    } else if (url != null && url.startsWith('http')) {
      image = Image.network(url, fit: BoxFit.cover, width: 240, height: 180);
    } else {
      image = ColoredBox(
        color: const Color(0xFF18181B),
        child: Center(
          child: downloading
              ? const CircularProgressIndicator(color: Vc.green, strokeWidth: 2)
              : IconButton(
                  onPressed: onRetry,
                  icon: const Icon(Icons.broken_image_outlined, color: Vc.muted),
                ),
        ),
      );
    }
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
              onTap: onOpen,
              child: SizedBox(
                width: 240,
                height: 180,
                child: image,
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
                    onPressed: onSave,
                    icon: const Icon(Icons.save_alt, size: 16),
                    label: const Text('Save'),
                  ),
                  TextButton.icon(
                    onPressed: onShare,
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
    required this.onOpen,
    required this.onDownload,
    required this.onShare,
    this.downloading = false,
  });

  final AppChatEvent event;
  final VoidCallback onOpen;
  final VoidCallback onDownload;
  final VoidCallback onShare;
  final bool downloading;

  @override
  Widget build(BuildContext context) {
    final mine = event.isUser;
    final ready = event.localPath != null && File(event.localPath!).existsSync();
    final kind = detectPreviewKind(name: event.name, mime: event.mime, kind: event.kind);
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
            InkWell(
              onTap: downloading ? null : onOpen,
              borderRadius: BorderRadius.circular(10),
              child: Row(
                children: [
                  Icon(kindIcon(kind), color: Vc.green, size: 22),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(event.name ?? 'file', maxLines: 2, overflow: TextOverflow.ellipsis),
                        Text(
                          [
                            kindLabel(kind),
                            if (event.size != null) formatBytes(event.size!),
                          ].join(' · '),
                          style: const TextStyle(color: Vc.muted, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    downloading ? Icons.downloading : Icons.chevron_right,
                    color: Vc.muted,
                    size: 20,
                  ),
                ],
              ),
            ),
            if (event.text.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(event.text, style: const TextStyle(fontSize: 13)),
              ),
            Wrap(
              spacing: 0,
              children: [
                TextButton.icon(
                  onPressed: downloading ? null : onOpen,
                  icon: downloading
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Vc.green),
                        )
                      : const Icon(Icons.visibility_outlined, size: 16),
                  label: Text(downloading ? 'Loading' : 'Open'),
                ),
                TextButton.icon(
                  onPressed: downloading ? null : onDownload,
                  icon: Icon(ready ? Icons.download_done : Icons.download, size: 16),
                  label: Text(ready ? 'Saved' : 'Save'),
                ),
                TextButton.icon(
                  onPressed: ready ? onShare : null,
                  icon: const Icon(Icons.share_outlined, size: 16),
                  label: const Text('Share'),
                ),
                if (event.url != null && event.url!.startsWith('http'))
                  TextButton.icon(
                    onPressed: () {
                      launchUrl(Uri.parse(event.url!), mode: LaunchMode.externalApplication);
                    },
                    icon: const Icon(Icons.link, size: 16),
                    label: const Text('Link'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class ToolFold extends StatefulWidget {
  const ToolFold({super.key, required this.tools, this.expanded = false});
  final List<AppChatEvent> tools;
  final bool expanded;

  @override
  State<ToolFold> createState() => _ToolFoldState();
}

class _ToolFoldState extends State<ToolFold> {
  late bool open;

  @override
  void initState() {
    super.initState();
    open = widget.expanded;
  }

  @override
  void didUpdateWidget(covariant ToolFold old) {
    super.didUpdateWidget(old);
    if (widget.expanded != old.expanded && widget.expanded) {
      open = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.tools.length;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 2, 16, 2),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: false,
          onExpansionChanged: (v) => setState(() => open = v),
          dense: true,
          tilePadding: const EdgeInsets.symmetric(horizontal: 4),
          childrenPadding: const EdgeInsets.fromLTRB(0, 0, 0, 6),
          leading: Icon(
            widget.expanded ? Icons.more_horiz : Icons.check_circle_outline,
            size: 16,
            color: widget.expanded ? Vc.muted : Vc.faint,
          ),
          title: Text(
            n == 1 ? 'Used 1 tool' : 'Used $n tools',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Vc.muted),
          ),
          children: [for (final ev in widget.tools) ToolLine(event: ev, inset: true)],
        ),
      ),
    );
  }
}

class ToolLine extends StatelessWidget {
  const ToolLine({super.key, required this.event, this.inset = false});
  final AppChatEvent event;
  final bool inset;

  @override
  Widget build(BuildContext context) {
    final done = event.state == 'done';
    final title = event.command != null && event.command!.isNotEmpty
        ? event.command!
        : (event.name ?? event.text);
    final out = (event.stdout ?? '').trim();
    return Padding(
      padding: inset
          ? const EdgeInsets.fromLTRB(8, 1, 8, 1)
          : const EdgeInsets.fromLTRB(16, 2, 64, 2),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFF16181D),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFF2A2E36)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    done ? Icons.check : Icons.play_arrow_rounded,
                    size: 13,
                    color: done ? Vc.greenSoft : Vc.amber,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        height: 1.25,
                        fontFamily: 'monospace',
                        color: Color(0xFFC4C4C8),
                      ),
                    ),
                  ),
                  if (event.name != null && event.name!.isNotEmpty)
                    Text(
                      event.name!,
                      style: const TextStyle(fontSize: 10, color: Vc.faint, fontWeight: FontWeight.w600),
                    ),
                ],
              ),
              if (out.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 3, left: 19),
                  child: Text(
                    out,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10,
                      height: 1.3,
                      fontFamily: 'monospace',
                      color: Color(0xFF8B8B93),
                    ),
                  ),
                ),
            ],
          ),
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
  const DraftTray({super.key, required this.items, required this.onRemove, this.onOpen});
  final List<DraftAttach> items;
  final ValueChanged<DraftAttach> onRemove;
  final ValueChanged<DraftAttach>? onOpen;

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
                  child: GestureDetector(
                    onTap: onOpen == null ? null : () => onOpen!(f),
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
                                        Icon(
                                          kindIcon(detectPreviewKind(name: f.name, mime: f.mime, kind: f.kind)),
                                          color: Vc.green,
                                          size: 22,
                                        ),
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

