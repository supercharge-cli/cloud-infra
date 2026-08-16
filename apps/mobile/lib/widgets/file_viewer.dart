import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

import '../files/kinds.dart';
import '../files/readers.dart';
import '../theme.dart';
import 'markdown.dart';

class FileViewerScreen extends StatefulWidget {
  const FileViewerScreen({
    super.key,
    required this.path,
    required this.title,
    this.mime,
    this.onShare,
    this.onSave,
  });

  final String path;
  final String title;
  final String? mime;
  final VoidCallback? onShare;
  final VoidCallback? onSave;

  @override
  State<FileViewerScreen> createState() => _FileViewerScreenState();
}

class _FileViewerScreenState extends State<FileViewerScreen> {
  late final PreviewKind kind;
  late final File file;
  Object? error;
  bool loading = true;
  TextLoad? text;
  ParseResult? parsed;
  int? pdfPages;
  int pdfPage = 0;
  String? pdfPath;
  final _pdf = PdfViewerController();
  int sheetIndex = 0;
  int slideIndex = 0;
  VideoPlayerController? video;
  AudioPlayer? audio;
  Duration audioPos = Duration.zero;
  Duration audioLen = Duration.zero;
  PlayerState audioState = PlayerState.stopped;
  StreamSubscription<Duration>? _posSub;
  StreamSubscription<Duration>? _durSub;
  StreamSubscription<PlayerState>? _stSub;

  @override
  void initState() {
    super.initState();
    file = File(widget.path);
    kind = detectPreviewKind(name: widget.title, mime: widget.mime);
    _pdf.addListener(_onPdf);
    unawaited(_load());
  }

  void _onPdf() {
    if (!mounted) return;
    try {
      final page = _pdf.pageNumber;
      if (page == null) return;
      final total = _pdf.pageCount;
      if (pdfPage == page - 1 && pdfPages == total) return;
      setState(() {
        pdfPage = page - 1;
        pdfPages = total;
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _pdf.removeListener(_onPdf);
    unawaited(video?.dispose());
    unawaited(_posSub?.cancel());
    unawaited(_durSub?.cancel());
    unawaited(_stSub?.cancel());
    unawaited(audio?.dispose());
    super.dispose();
  }

  Future<void> _load() async {
    try {
      if (!file.existsSync()) {
        throw StateError('File is missing on this device.');
      }
      final size = await file.length();
      switch (kind) {
        case PreviewKind.image:
        case PreviewKind.svg:
          if (mounted) setState(() => loading = false);
          return;
        case PreviewKind.pdf:
          pdfPath = await _preparePdf(file);
          if (mounted) setState(() => loading = false);
          return;
        case PreviewKind.video:
          final c = VideoPlayerController.file(file);
          await c.initialize();
          c.setLooping(true);
          video = c;
          if (mounted) setState(() => loading = false);
          return;
        case PreviewKind.audio:
          final p = AudioPlayer();
          await p.setSource(DeviceFileSource(widget.path));
          audioLen = await p.getDuration() ?? Duration.zero;
          _posSub = p.onPositionChanged.listen((d) {
            if (mounted) setState(() => audioPos = d);
          });
          _durSub = p.onDurationChanged.listen((d) {
            if (mounted) setState(() => audioLen = d);
          });
          _stSub = p.onPlayerStateChanged.listen((s) {
            if (mounted) setState(() => audioState = s);
          });
          audio = p;
          if (mounted) setState(() => loading = false);
          return;
        case PreviewKind.markdown:
        case PreviewKind.text:
        case PreviewKind.code:
        case PreviewKind.json:
          final bytes = await _readCapped(size);
          if (!mounted) return;
          setState(() {
            text = loadText(bytes, jsonPretty: kind == PreviewKind.json);
            loading = false;
          });
          return;
        case PreviewKind.html:
        case PreviewKind.csv:
        case PreviewKind.document:
        case PreviewKind.spreadsheet:
        case PreviewKind.slides:
        case PreviewKind.epub:
        case PreviewKind.archive:
          if (size > maxParseBytes) {
            if (!mounted) return;
            setState(() {
              error = 'File is ${formatBytes(size)} — too large to preview.';
              loading = false;
            });
            return;
          }
          final bytes = await file.readAsBytes();
          final result = await compute(parseFileJob, {
            'kind': kind.name,
            'name': widget.title,
            'bytes': bytes,
          });
          if (!mounted) return;
          setState(() {
            parsed = result;
            error = result.error;
            loading = false;
          });
          return;
        case PreviewKind.binary:
          final bytes = await _readCapped(size, cap: maxHexBytes);
          if (!mounted) return;
          setState(() {
            text = TextLoad(text: hexDump(bytes, limit: bytes.length), truncated: size > maxHexBytes);
            loading = false;
          });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = e;
        loading = false;
      });
    }
  }

  Future<String> _preparePdf(File src) async {
    final size = await src.length();
    if (size < 5) throw StateError('This PDF is empty.');
    final head = await src.openRead(0, 8).first;
    final magic = String.fromCharCodes(head.take(5));
    if (magic != '%PDF-') {
      throw StateError('This file is not a valid PDF (missing %PDF header).');
    }
    final tmp = await getTemporaryDirectory();
    final dest = File('${tmp.path}/vectra-preview.pdf');
    await dest.writeAsBytes(await src.readAsBytes(), flush: true);
    return dest.path;
  }

  Future<Uint8List> _readCapped(int size, {int cap = maxTextBytes}) async {
    if (size <= cap) return file.readAsBytes();
    final raf = await file.open();
    try {
      return await raf.read(cap);
    } finally {
      await raf.close();
    }
  }

  Future<void> _openExternal() async {
    final result = await OpenFilex.open(widget.path);
    if (!mounted) return;
    if (result.type != ResultType.done) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message)),
      );
    }
  }

  Future<void> _openZipEntry(ZipItem item) async {
    if (!item.isFile) return;
    setState(() => loading = true);
    try {
      final bytes = await file.readAsBytes();
      final extracted = await compute(_extractNamed, {'bytes': bytes, 'name': item.name});
      if (extracted == null) throw StateError('Could not extract ${item.name}');
      final tmp = await getTemporaryDirectory();
      final safe = item.name.replaceAll(RegExp(r'^[\\/]+'), '').replaceAll('..', '_');
      final out = File('${tmp.path}/vectra-preview/$safe');
      await out.parent.create(recursive: true);
      await out.writeAsBytes(extracted, flush: true);
      if (!mounted) return;
      setState(() => loading = false);
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FileViewerScreen(
            path: out.path,
            title: fileBaseName(item.name),
            onShare: widget.onShare,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = e;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Vc.bg,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(
              _subtitle(),
              style: const TextStyle(color: Vc.muted, fontSize: 11, fontWeight: FontWeight.w500),
            ),
          ],
        ),
        actions: [
          if (kind == PreviewKind.pdf && pdfPages != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(
                child: Text(
                  '${pdfPage + 1} / $pdfPages',
                  style: const TextStyle(color: Vc.muted, fontSize: 12),
                ),
              ),
            ),
          IconButton(
            tooltip: 'Copy',
            onPressed: _copyable == null
                ? null
                : () {
                    Clipboard.setData(ClipboardData(text: _copyable!));
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
                  },
            icon: const Icon(Icons.copy_outlined, size: 20),
          ),
          IconButton(
            tooltip: 'Open in another app',
            onPressed: _openExternal,
            icon: const Icon(Icons.open_in_new, size: 20),
          ),
          if (widget.onSave != null)
            IconButton(tooltip: 'Save', onPressed: widget.onSave, icon: const Icon(Icons.save_alt, size: 20)),
          if (widget.onShare != null)
            IconButton(tooltip: 'Share', onPressed: widget.onShare, icon: const Icon(Icons.share_outlined, size: 20)),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator(color: Vc.green, strokeWidth: 2))
          : error != null && parsed == null && text == null && video == null && audio == null
              ? _ErrorPane(message: '$error', onExternal: _openExternal)
              : _body(),
    );
  }

  String? get _copyable {
    if (text != null) return text!.text;
    if (parsed?.text != null) return parsed!.text;
    if (parsed?.slides.isNotEmpty == true) return parsed!.slides.join('\n\n---\n\n');
    return null;
  }

  String _subtitle() {
    final bits = <String>[kindLabel(kind)];
    try {
      bits.add(formatBytes(file.lengthSync()));
    } catch (_) {}
    if (parsed?.truncated == true || text?.truncated == true) bits.add('preview');
    if (kind == PreviewKind.spreadsheet && parsed?.sheets.isNotEmpty == true) {
      bits.add('${parsed!.sheets.length} sheet${parsed!.sheets.length == 1 ? '' : 's'}');
    }
    if (kind == PreviewKind.slides && parsed?.slides.isNotEmpty == true) {
      bits.add('${slideIndex + 1} / ${parsed!.slides.length}');
    }
    return bits.join(' · ');
  }

  Widget _body() {
    if (error != null && (kind == PreviewKind.document || kind == PreviewKind.spreadsheet || kind == PreviewKind.slides)) {
      return _ErrorPane(message: '$error', onExternal: _openExternal);
    }
    switch (kind) {
      case PreviewKind.image:
        return _ImagePane(path: widget.path);
      case PreviewKind.svg:
        return InteractiveViewer(
          minScale: 0.4,
          maxScale: 8,
          child: Center(
            child: SvgPicture.file(file, fit: BoxFit.contain),
          ),
        );
      case PreviewKind.pdf:
        if (error != null) {
          return _ErrorPane(message: '$error', onExternal: _openExternal);
        }
        return PdfViewer.file(
          pdfPath ?? widget.path,
          controller: _pdf,
          params: PdfViewerParams(
            backgroundColor: Colors.black,
            errorBannerBuilder: (context, err, stack, documentRef) {
              return _ErrorPane(
                message: err.toString().replaceFirst('Exception: ', ''),
                onExternal: _openExternal,
              );
            },
          ),
        );
      case PreviewKind.markdown:
      case PreviewKind.html:
      case PreviewKind.epub:
        return _MarkdownPane(data: text?.text ?? parsed?.text ?? '');
      case PreviewKind.json:
      case PreviewKind.code:
      case PreviewKind.text:
      case PreviewKind.binary:
        return _CodePane(
          data: text?.text ?? '',
          language: kind == PreviewKind.json ? 'json' : highlightLanguage(widget.title),
          highlight: kind != PreviewKind.binary && kind != PreviewKind.text && (text?.text.length ?? 0) <= maxHighlightBytes,
        );
      case PreviewKind.csv:
      case PreviewKind.spreadsheet:
        return _SheetPane(
          sheets: parsed?.sheets ?? const [],
          index: sheetIndex,
          onIndex: (i) => setState(() => sheetIndex = i),
        );
      case PreviewKind.document:
        return _MarkdownPane(data: parsed?.text ?? '');
      case PreviewKind.slides:
        return _SlidesPane(
          slides: parsed?.slides ?? const [],
          index: slideIndex,
          onIndex: (i) => setState(() => slideIndex = i),
        );
      case PreviewKind.archive:
        return _ZipPane(
          entries: parsed?.entries ?? const [],
          truncated: parsed?.truncated == true,
          onOpen: _openZipEntry,
        );
      case PreviewKind.video:
        return _VideoPane(controller: video!);
      case PreviewKind.audio:
        return _AudioPane(
          title: widget.title,
          playing: audioState == PlayerState.playing,
          position: audioPos,
          duration: audioLen,
          onSeek: (d) => audio?.seek(d),
          onToggle: () {
            if (audioState == PlayerState.playing) {
              unawaited(audio?.pause());
            } else if (audioState == PlayerState.paused) {
              unawaited(audio?.resume());
            } else {
              unawaited(audio?.play(DeviceFileSource(widget.path)));
            }
          },
        );
    }
  }
}

Uint8List? _extractNamed(Map<String, dynamic> job) {
  return extractZipEntry(job['bytes'] as Uint8List, job['name'] as String);
}

class _ImagePane extends StatelessWidget {
  const _ImagePane({required this.path});
  final String path;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: InteractiveViewer(
          minScale: 0.4,
          maxScale: 8,
          child: Image.file(File(path), fit: BoxFit.contain),
        ),
      ),
    );
  }
}

class _MarkdownPane extends StatelessWidget {
  const _MarkdownPane({required this.data});
  final String data;

  @override
  Widget build(BuildContext context) {
    if (data.trim().isEmpty) {
      return const _EmptyPane('Nothing to show in this file.');
    }
    return SelectionArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [ChatMarkdown(data: data)],
      ),
    );
  }
}

class _CodePane extends StatelessWidget {
  const _CodePane({required this.data, this.language, this.highlight = false});
  final String data;
  final String? language;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const _EmptyPane('Empty file.');
    if (highlight && language != null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 24),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: HighlightView(
            data,
            language: language,
            theme: atomOneDarkTheme,
            padding: const EdgeInsets.all(12),
            textStyle: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13,
              height: 1.45,
            ),
          ),
        ),
      );
    }
    final lines = const LineSplitter().convert(data);
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 24),
      itemCount: lines.length,
      itemBuilder: (ctx, i) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 0.5),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 44,
                child: Text(
                  '${i + 1}',
                  textAlign: TextAlign.right,
                  style: const TextStyle(color: Vc.faint, fontSize: 11, fontFamily: 'monospace', height: 1.45),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: SelectableText(
                  lines[i].isEmpty ? ' ' : lines[i],
                  style: const TextStyle(
                    color: Color(0xFFE4E4E7),
                    fontSize: 13,
                    height: 1.45,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SheetPane extends StatelessWidget {
  const _SheetPane({required this.sheets, required this.index, required this.onIndex});
  final List<SheetData> sheets;
  final int index;
  final ValueChanged<int> onIndex;

  @override
  Widget build(BuildContext context) {
    if (sheets.isEmpty) return const _EmptyPane('No cells to show.');
    final i = index.clamp(0, sheets.length - 1);
    final sheet = sheets[i];
    final cols = sheet.rows.fold<int>(0, (m, r) => r.length > m ? r.length : m);
    return Column(
      children: [
        if (sheets.length > 1)
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              itemCount: sheets.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (ctx, n) {
                final selected = n == i;
                return ChoiceChip(
                  label: Text(sheets[n].name, style: const TextStyle(fontSize: 12)),
                  selected: selected,
                  onSelected: (_) => onIndex(n),
                  selectedColor: Vc.green.withValues(alpha: 0.2),
                );
              },
            ),
          ),
        if (sheet.truncated)
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Showing a preview of this sheet.', style: TextStyle(color: Vc.muted, fontSize: 11)),
            ),
          ),
        Expanded(
          child: sheet.rows.isEmpty
              ? const _EmptyPane('This sheet is empty.')
              : Scrollbar(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: SizedBox(
                      width: (cols * 148.0).clamp(320, 2400),
                      child: ListView.builder(
                        itemCount: sheet.rows.length,
                        itemBuilder: (ctx, r) {
                          final row = sheet.rows[r];
                          final header = r == 0;
                          return DecoratedBox(
                            decoration: BoxDecoration(
                              color: header ? Vc.elevated : (r.isEven ? Vc.card : Vc.surface),
                              border: const Border(bottom: BorderSide(color: Vc.cardBorder, width: 0.6)),
                            ),
                            child: Row(
                              children: [
                                for (var c = 0; c < cols; c++)
                                  SizedBox(
                                    width: 148,
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                      child: Text(
                                        c < row.length ? row[c] : '',
                                        maxLines: 3,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: header ? FontWeight.w700 : FontWeight.w400,
                                          color: header ? Colors.white : const Color(0xFFE4E4E7),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _SlidesPane extends StatelessWidget {
  const _SlidesPane({required this.slides, required this.index, required this.onIndex});
  final List<String> slides;
  final int index;
  final ValueChanged<int> onIndex;

  @override
  Widget build(BuildContext context) {
    if (slides.isEmpty) return const _EmptyPane('No slide text found.');
    final i = index.clamp(0, slides.length - 1);
    return Column(
      children: [
        Expanded(
          child: PageView.builder(
            controller: PageController(initialPage: i),
            onPageChanged: onIndex,
            itemCount: slides.length,
            itemBuilder: (ctx, n) {
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                children: [
                  Text('Slide ${n + 1}', style: const TextStyle(color: Vc.green, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  SelectableText(
                    slides[n],
                    style: const TextStyle(fontSize: 16, height: 1.45, color: Colors.white),
                  ),
                ],
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
          child: Row(
            children: [
              IconButton(
                onPressed: i > 0 ? () => onIndex(i - 1) : null,
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: Text(
                  '${i + 1} / ${slides.length}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Vc.muted),
                ),
              ),
              IconButton(
                onPressed: i < slides.length - 1 ? () => onIndex(i + 1) : null,
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ZipPane extends StatelessWidget {
  const _ZipPane({required this.entries, required this.truncated, required this.onOpen});
  final List<ZipItem> entries;
  final bool truncated;
  final ValueChanged<ZipItem> onOpen;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const _EmptyPane('Archive is empty.');
    return Column(
      children: [
        if (truncated)
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Showing the first files in this archive.', style: TextStyle(color: Vc.muted, fontSize: 11)),
            ),
          ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 24),
            itemCount: entries.length,
            separatorBuilder: (_, _) => const Divider(height: 1, color: Vc.cardBorder),
            itemBuilder: (ctx, i) {
              final e = entries[i];
              final kind = detectPreviewKind(name: e.name);
              return ListTile(
                dense: true,
                leading: Icon(e.isFile ? kindIcon(kind) : Icons.folder_outlined, color: Vc.green, size: 20),
                title: Text(e.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                subtitle: Text(
                  e.isFile ? formatBytes(e.size) : 'folder',
                  style: const TextStyle(color: Vc.muted, fontSize: 11),
                ),
                onTap: e.isFile ? () => onOpen(e) : null,
              );
            },
          ),
        ),
      ],
    );
  }
}

class _VideoPane extends StatefulWidget {
  const _VideoPane({required this.controller});
  final VideoPlayerController controller;

  @override
  State<_VideoPane> createState() => _VideoPaneState();
}

class _VideoPaneState extends State<_VideoPane> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_tick);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_tick);
    super.dispose();
  }

  void _tick() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: AspectRatio(
          aspectRatio: controller.value.aspectRatio == 0 ? 16 / 9 : controller.value.aspectRatio,
          child: Stack(
            alignment: Alignment.bottomCenter,
            children: [
              VideoPlayer(controller),
              VideoProgressIndicator(controller, allowScrubbing: true, colors: const VideoProgressColors(playedColor: Vc.green)),
              Center(
                child: IconButton(
                  iconSize: 56,
                  color: Colors.white,
                  onPressed: () {
                    if (controller.value.isPlaying) {
                      controller.pause();
                    } else {
                      controller.play();
                    }
                  },
                  icon: Icon(controller.value.isPlaying ? Icons.pause_circle : Icons.play_circle),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AudioPane extends StatelessWidget {
  const _AudioPane({
    required this.title,
    required this.playing,
    required this.position,
    required this.duration,
    required this.onToggle,
    required this.onSeek,
  });
  final String title;
  final bool playing;
  final Duration position;
  final Duration duration;
  final VoidCallback onToggle;
  final ValueChanged<Duration> onSeek;

  @override
  Widget build(BuildContext context) {
    final total = duration.inMilliseconds == 0 ? 1 : duration.inMilliseconds;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.audiotrack, size: 72, color: Vc.green),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 24),
          Slider(
            value: position.inMilliseconds.clamp(0, total).toDouble(),
            max: total.toDouble(),
            activeColor: Vc.green,
            onChanged: (v) => onSeek(Duration(milliseconds: v.round())),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_fmtDur(position), style: const TextStyle(color: Vc.muted, fontSize: 12)),
              Text(_fmtDur(duration), style: const TextStyle(color: Vc.muted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          IconButton.filled(
            onPressed: onToggle,
            iconSize: 36,
            icon: Icon(playing ? Icons.pause : Icons.play_arrow),
          ),
        ],
      ),
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({required this.message, required this.onExternal});
  final String message;
  final VoidCallback onExternal;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.visibility_off_outlined, color: Vc.muted, size: 40),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Vc.muted)),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onExternal,
            icon: const Icon(Icons.open_in_new),
            label: const Text('Open in another app'),
          ),
        ],
      ),
    );
  }
}

class _EmptyPane extends StatelessWidget {
  const _EmptyPane(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(child: Text(message, style: const TextStyle(color: Vc.muted)));
  }
}

String _fmtDur(Duration d) {
  final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  final h = d.inHours;
  return h > 0 ? '$h:$m:$s' : '$m:$s';
}
