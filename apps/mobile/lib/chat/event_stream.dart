import 'dart:async';
import 'dart:convert';

String? nextEventCursor(String? current, Object? candidate) {
  final value = '$candidate';
  if (!RegExp(r'^\d+$').hasMatch(value)) return current;
  final next = int.tryParse(value);
  if (next == null || next <= 0) return current;
  final previous = int.tryParse(current ?? '') ?? 0;
  return next > previous ? value : current;
}

Stream<Map<String, dynamic>> decodeEventStream(Stream<List<int>> bytes) async* {
  final data = <String>[];
  await for (final line in bytes.transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.isEmpty) {
      if (data.isNotEmpty) {
        try {
          final value = jsonDecode(data.join('\n'));
          if (value is Map<String, dynamic>) yield value;
        } on FormatException {
          // A malformed event does not invalidate subsequent SSE frames.
        }
        data.clear();
      }
    } else if (line.startsWith('data:')) {
      var value = line.substring(5);
      if (value.startsWith(' ')) value = value.substring(1);
      data.add(value);
    }
  }
}

class EventStreamCancellation {
  bool _cancelled = false;
  final _callbacks = <void Function()>{};
  bool get isCancelled => _cancelled;

  void Function() onCancel(void Function() callback) {
    if (_cancelled) {
      callback();
    } else {
      _callbacks.add(callback);
    }
    return () => _callbacks.remove(callback);
  }

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final callback in List.of(_callbacks)) { callback(); }
    _callbacks.clear();
  }
}
