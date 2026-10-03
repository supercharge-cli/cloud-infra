import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../api/client.dart';
import '../theme.dart';
import 'bot_profile.dart';

IconData botPresetIcon(String icon) => switch (icon) {
  '🤖' => Icons.smart_toy_outlined,
  '🔎' => Icons.search,
  '🛠️' => Icons.build_outlined,
  '🎨' => Icons.palette_outlined,
  '📝' => Icons.edit_note_outlined,
  '📊' => Icons.bar_chart_outlined,
  '🧠' => Icons.psychology_outlined,
  '🌐' => Icons.language_outlined,
  '⚡' => Icons.bolt_outlined,
  '✨' => Icons.auto_awesome_outlined,
  '💻' => Icons.code_outlined,
  '🧪' => Icons.science_outlined,
  '🔒' => Icons.lock_outline,
  _ => Icons.smart_toy_outlined,
};

class BotAvatar extends StatefulWidget {
  static void clearCache() => _BotAvatarState.clearCache();

  const BotAvatar({
    super.key,
    required this.bot,
    required this.instanceId,
    required this.client,
    this.radius = 22,
  });

  final BotProfile bot;
  final String instanceId;
  final VectraClient client;
  final double radius;

  @override
  State<BotAvatar> createState() => _BotAvatarState();
}

class _BotAvatarState extends State<BotAvatar> {
  static final _cache = <String, Uint8List>{};
  static final _pending = <String, Future<Uint8List>>{};
  static int _epoch = 0;

  static void clearCache() {
    _epoch++;
    _cache.clear();
    _pending.clear();
  }

  Uint8List? bytes;
  String? requested;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(BotAvatar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instanceId != widget.instanceId ||
        oldWidget.bot.id != widget.bot.id ||
        oldWidget.bot.icon != widget.bot.icon ||
        oldWidget.client != widget.client) {
      _load();
    }
  }

  void _load() {
    final icon = widget.bot.icon;
    if (icon.startsWith('data:image/')) {
      try {
        bytes = base64Decode(icon.split(',').last);
      } catch (_) {
        bytes = null;
      }
      requested = null;
      return;
    }
    final version = widget.bot.avatarVersion;
    if (version == null) {
      bytes = null;
      requested = null;
      return;
    }
    final key =
        '${widget.client.baseUrl}:${widget.instanceId}:${widget.bot.id}:$version';
    requested = key;
    bytes = _cache[key];
    if (bytes != null) return;
    final epoch = _epoch;
    final request = _pending.putIfAbsent(
      key,
      () => widget.client.botAvatar(widget.instanceId, widget.bot.id, version),
    );
    request
        .then((image) {
          if (epoch != _epoch || image.length > 1024 * 1024 || image.isEmpty) {
            return;
          }
          if (_cache.length >= 24) _cache.remove(_cache.keys.first);
          _cache[key] = image;
          if (mounted && requested == key) setState(() => bytes = image);
        })
        .catchError((Object _) {})
        .whenComplete(() {
          if (_pending[key] == request) _pending.remove(key);
        });
  }

  @override
  Widget build(BuildContext context) {
    final image = bytes;
    return CircleAvatar(
      radius: widget.radius,
      backgroundColor: Vc.green.withValues(alpha: 0.12),
      child: image == null
          ? widget.bot.icon == 'github'
                ? SvgPicture.asset(
                    'assets/icons/github.svg',
                    width: widget.radius * 1.05,
                    height: widget.radius * 1.05,
                    colorFilter: const ColorFilter.mode(
                      Vc.greenSoft,
                      BlendMode.srcIn,
                    ),
                  )
                : Icon(
                    botPresetIcon(widget.bot.icon),
                    color: Vc.greenSoft,
                    size: widget.radius * 1.05,
                  )
          : ClipOval(
              child: Image.memory(
                image,
                width: widget.radius * 2,
                height: widget.radius * 2,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const Icon(Icons.smart_toy_outlined),
              ),
            ),
    );
  }
}
