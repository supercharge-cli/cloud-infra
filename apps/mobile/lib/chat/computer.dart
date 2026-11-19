import 'package:flutter/foundation.dart';

import '../api/models.dart';

const _maxLines = 200;

class ComputerFrame {
  const ComputerFrame({
    required this.type,
    this.seq = 0,
    this.bytes,
    this.connected,
    this.screencasting,
    this.error,
    this.desktop,
  });

  final String type;
  final int seq;
  final Uint8List? bytes;
  final bool? connected;
  final bool? screencasting;
  final String? error;
  final bool? desktop;
}

class ComputerLine {
  const ComputerLine({
    required this.command,
    this.stdout = '',
    this.running = false,
    this.exitCode,
    this.success,
  });

  final String command;
  final String stdout;
  final bool running;
  final int? exitCode;
  final bool? success;

  ComputerLine copyWith({
    String? stdout,
    bool? running,
    int? exitCode,
    bool? success,
  }) {
    return ComputerLine(
      command: command,
      stdout: stdout ?? this.stdout,
      running: running ?? this.running,
      exitCode: exitCode ?? this.exitCode,
      success: success ?? this.success,
    );
  }
}

class ComputerState extends ChangeNotifier {
  String _tab = 'terminal';
  final List<ComputerLine> lines = [];
  String? browserLabel;
  String? browserUrl;
  String? stillPath;
  String? stillUrl;
  Uint8List? liveJpeg;
  bool live = false;
  bool livePaused = false;
  DateTime? lastFrameAt;
  bool hasActivity = false;
  bool agentWorking = false;
  bool desktopAvailable = false;

  String get screenLabel => 'Agent computer';
  String get tab => _tab;
  set tab(String value) {
    if (_tab == value) return;
    _tab = value;
    notifyListeners();
  }

  bool get isBrowser => _tab == 'browser';
  bool get isPreview => _tab == 'preview';

  bool get hasPreview =>
      (liveJpeg != null && liveJpeg!.isNotEmpty) ||
      (stillPath != null && stillPath!.isNotEmpty) ||
      (stillUrl != null && stillUrl!.isNotEmpty);

  String get usingLabel => isPreview
      ? 'Vectra is showing Preview'
      : isBrowser
      ? 'Vectra is using $screenLabel'
      : 'Vectra is using Terminal';

  String get usingDetail {
    if (isBrowser) {
      if (browserUrl != null && browserUrl!.isNotEmpty) return browserUrl!;
      if (browserLabel != null && browserLabel!.isNotEmpty) {
        return browserLabel!;
      }
      return desktopAvailable
          ? 'Live Ubuntu desktop in this E2B VM'
          : 'No page open';
    }
    if (lines.isEmpty) return 'Waiting for commands';
    final last = lines.last;
    if (last.running) return 'Executing command: ${last.command}';
    return last.command;
  }

  void setAgentWorking(bool value) {
    if (agentWorking == value) return;
    agentWorking = value;
    notifyListeners();
  }

  void clear() {
    _tab = 'terminal';
    lines.clear();
    browserLabel = null;
    browserUrl = null;
    stillPath = null;
    stillUrl = null;
    liveJpeg = null;
    live = false;
    livePaused = false;
    lastFrameAt = null;
    hasActivity = false;
    agentWorking = false;
    desktopAvailable = false;
    notifyListeners();
  }

  void replay(Iterable<AppChatEvent> events) {
    clear();
    for (final ev in events) {
      if (ev.type == 'computer') apply(ev);
      if (ev.type == 'file' && ev.isImage) {
        setStill(path: ev.localPath, url: ev.url);
      }
    }
  }

  String get peekLabel {
    if (isBrowser) {
      return browserLabel == null || browserLabel!.isEmpty
          ? screenLabel
          : browserLabel!;
    }
    if (lines.isEmpty) return 'Terminal';
    final last = lines.last;
    final cmd = last.command;
    return cmd.length > 48 ? '${cmd.substring(0, 47)}…' : cmd;
  }

  void apply(AppChatEvent ev) {
    hasActivity = true;
    final nextTab = ev.tab;
    final shouldFocus = ev.focus || ev.kind == 'focus' || ev.action == 'show';
    if (shouldFocus && (nextTab == 'browser' || nextTab == 'terminal')) {
      _tab = nextTab!;
    }
    if (ev.kind == 'browser' || nextTab == 'browser') {
      browserLabel = (ev.label != null && ev.label!.isNotEmpty)
          ? ev.label
          : ev.text;
      if (ev.url != null && ev.url!.isNotEmpty) browserUrl = ev.url;
    }
    if (ev.kind != 'file' && ev.kind != 'focus') {
      _applyTerminal(ev);
    }
    notifyListeners();
  }

  void _applyTerminal(AppChatEvent ev) {
    final hasCmd = ev.command != null && ev.command!.isNotEmpty;
    if (!hasCmd && (ev.kind == 'browser' || ev.action == 'screenshot')) return;
    final cmd = hasCmd
        ? ev.command!
        : (ev.label != null && ev.label!.isNotEmpty ? ev.label! : ev.text);
    if (cmd.isEmpty) return;
    if (ev.state != 'done') {
      lines.add(ComputerLine(command: cmd, running: true));
      _trim();
      return;
    }
    final i = lines.lastIndexWhere((l) => l.running && l.command == cmd);
    final next = ComputerLine(
      command: cmd,
      stdout: ev.stdout ?? '',
      running: false,
      exitCode: ev.exitCode,
      success: ev.success,
    );
    if (i >= 0) {
      lines[i] = next;
    } else {
      lines.add(next);
    }
    _trim();
  }

  void setLiveFrame(Uint8List bytes) {
    liveJpeg = bytes;
    live = true;
    livePaused = false;
    lastFrameAt = DateTime.now();
    hasActivity = true;
    notifyListeners();
  }

  void markLivePaused() {
    if (live && !livePaused) {
      livePaused = true;
      notifyListeners();
    }
  }

  void setDesktopAvailable(bool enabled) {
    if (desktopAvailable == enabled) return;
    desktopAvailable = enabled;
    notifyListeners();
  }

  void setLiveStatus({bool? connected, bool? screencasting}) {
    if (screencasting == false || connected == false) {
      live = false;
      if (liveJpeg != null) livePaused = true;
      notifyListeners();
    }
  }

  void setStill({String? path, String? url}) {
    var changed = false;
    if (path != null && path.isNotEmpty) {
      stillPath = path;
      changed = true;
    }
    if (url != null && url.isNotEmpty) {
      stillUrl = url;
      changed = true;
    }
    if (stillPath != null || stillUrl != null) {
      hasActivity = true;
    }
    if (changed) notifyListeners();
  }

  void _trim() {
    if (lines.length > _maxLines) {
      lines.removeRange(0, lines.length - _maxLines);
    }
  }
}

/// Agent-chosen Computer pane. Matches the CLI `parseComputerShow`.
String? parseComputerShow(String text) {
  final re = RegExp(
    r'(?:^|\n)\s*(?:computer|show|watch)\s*[:\-]\s*(browser|terminal)\b|\[\s*computer\s*:\s*(browser|terminal)\s*\]',
    caseSensitive: false,
  );
  String? last;
  for (final m in re.allMatches(text)) {
    final raw = (m.group(1) ?? m.group(2) ?? '').toLowerCase();
    if (raw == 'browser' || raw == 'terminal') last = raw;
  }
  return last;
}

/// Which Computer tab an event should focus. Ordinary shell/browser
/// activity does not steal the pane — only an explicit focus.
String? computerTabForEvent(AppChatEvent ev) {
  if (ev.type == 'computer' &&
      (ev.focus || ev.kind == 'focus' || ev.action == 'show')) {
    if (ev.tab == 'browser' || ev.tab == 'terminal') return ev.tab;
  }
  return null;
}
