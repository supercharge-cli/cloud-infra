import 'dart:async';

import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../theme.dart';

class DesktopMediaPlayer extends StatefulWidget {
  const DesktopMediaPlayer({
    super.key,
    required this.path,
    required this.title,
    this.audio = false,
  });
  final String path;
  final String title;
  final bool audio;

  @override
  State<DesktopMediaPlayer> createState() => _DesktopMediaPlayerState();
}

class _DesktopMediaPlayerState extends State<DesktopMediaPlayer> {
  Player? _player;
  VideoController? _video;
  StreamSubscription<String>? _errors;
  String? _error;

  @override
  void initState() {
    super.initState();
    try {
      MediaKit.ensureInitialized();
      final player = Player();
      _player = player;
      _video = VideoController(player);
      _errors = player.stream.error.listen((message) {
        if (mounted) setState(() => _error = message);
      });
      unawaited(
        player.open(Media(widget.path), play: false).catchError((Object error) {
          if (mounted) setState(() => _error = error.toString());
        }),
      );
    } catch (error) {
      _error = error.toString();
    }
  }

  @override
  void dispose() {
    unawaited(_errors?.cancel());
    unawaited(_player?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: SelectableText(
            'Could not play this media.\n$_error',
            style: const TextStyle(color: Vc.muted),
          ),
        ),
      );
    }
    if (_video == null) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        if (widget.audio)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.audiotrack, color: Vc.greenSoft),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(widget.title, overflow: TextOverflow.ellipsis),
                ),
              ],
            ),
          ),
        Expanded(
          child: Video(
            controller: _video!,
            controls: MaterialDesktopVideoControls,
          ),
        ),
      ],
    );
  }
}
