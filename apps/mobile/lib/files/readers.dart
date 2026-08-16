import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';

import 'kinds.dart';

const maxTextBytes = 512 * 1024;
const maxHighlightBytes = 96 * 1024;
const maxParseBytes = 48 * 1024 * 1024;
const maxSheetRows = 1600;
const maxSheetCols = 48;
const maxZipEntries = 800;
const maxHexBytes = 4096;

class SheetData {
  SheetData({required this.name, required this.rows, this.truncated = false});
  final String name;
  final List<List<String>> rows;
  final bool truncated;
}

class ZipItem {
  ZipItem({required this.name, required this.size, required this.isFile});
  final String name;
  final int size;
  final bool isFile;
}

class ParseResult {
  ParseResult({
    this.text,
    this.sheets = const [],
    this.slides = const [],
    this.entries = const [],
    this.truncated = false,
    this.error,
  });
  final String? text;
  final List<SheetData> sheets;
  final List<String> slides;
  final List<ZipItem> entries;
  final bool truncated;
  final String? error;
}

class TextLoad {
  TextLoad({required this.text, required this.truncated, this.pretty = false});
  final String text;
  final bool truncated;
  final bool pretty;
}

String decodeBytes(Uint8List bytes) {
  if (bytes.length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
    return String.fromCharCodes(bytes.buffer.asUint16List(bytes.offsetInBytes + 2, (bytes.length - 2) ~/ 2));
  }
  if (bytes.length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
    final out = StringBuffer();
    for (var i = 2; i + 1 < bytes.length; i += 2) {
      out.writeCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out.toString();
  }
  try {
    return utf8.decode(bytes, allowMalformed: true);
  } catch (_) {
    return latin1.decode(bytes, allowInvalid: true);
  }
}

TextLoad loadText(Uint8List bytes, {bool jsonPretty = false}) {
  final truncated = bytes.length > maxTextBytes;
  final slice = truncated ? Uint8List.sublistView(bytes, 0, maxTextBytes) : bytes;
  var text = decodeBytes(slice);
  var pretty = false;
  if (jsonPretty) {
    try {
      final decoded = jsonDecode(text);
      text = const JsonEncoder.withIndent('  ').convert(decoded);
      pretty = true;
    } catch (_) {}
  }
  if (truncated) {
    text = '$text\n\n… truncated after ${formatBytes(maxTextBytes)}';
  }
  return TextLoad(text: text, truncated: truncated, pretty: pretty);
}

ParseResult parseFileJob(Map<String, dynamic> job) {
  final kind = PreviewKind.values.firstWhere(
    (k) => k.name == job['kind'],
    orElse: () => PreviewKind.binary,
  );
  final bytes = job['bytes'] as Uint8List;
  final name = job['name'] as String? ?? '';
  try {
    if (bytes.length > maxParseBytes) {
      return ParseResult(error: 'File is ${formatBytes(bytes.length)} — too large to preview in-app.');
    }
    switch (kind) {
      case PreviewKind.document:
        return _parseDocument(bytes, name);
      case PreviewKind.spreadsheet:
        return _parseSpreadsheet(bytes, name);
      case PreviewKind.slides:
        return _parseSlides(bytes, name);
      case PreviewKind.epub:
        return _parseEpub(bytes);
      case PreviewKind.archive:
        return _parseArchive(bytes, name);
      case PreviewKind.html:
        return ParseResult(text: htmlToReadable(decodeBytes(bytes)));
      case PreviewKind.csv:
        return ParseResult(sheets: [parseCsv(decodeBytes(bytes), name: fileBaseName(name))]);
      default:
        return ParseResult(error: 'No parser for this type.');
    }
  } catch (e) {
    return ParseResult(error: e.toString());
  }
}

ParseResult _parseDocument(Uint8List bytes, String name) {
  final ext = fileExt(name);
  if (ext == 'rtf' || looksLikeRtf(bytes)) {
    return ParseResult(text: rtfToText(decodeBytes(bytes)));
  }
  if (ext == 'doc' || (bytes.length > 8 && bytes[0] == 0xD0 && bytes[1] == 0xCF)) {
    return ParseResult(
      text: extractPrintable(bytes),
      truncated: true,
    );
  }
  final zip = ZipDecoder().decodeBytes(bytes);
  final doc = zip.findFile('word/document.xml') ?? zip.findFile('content.xml');
  if (doc == null) {
    return ParseResult(error: 'Could not read this document.');
  }
  final xml = decodeBytes(doc.content);
  if (xml.contains('office:document-content') || xml.contains('text:p')) {
    return ParseResult(text: odtToText(xml));
  }
  return ParseResult(text: wordXmlToText(xml));
}

ParseResult _parseSpreadsheet(Uint8List bytes, String name) {
  final ext = fileExt(name);
  if (ext == 'xls' || (bytes.length > 8 && bytes[0] == 0xD0 && bytes[1] == 0xCF)) {
    return ParseResult(text: extractPrintable(bytes), truncated: true);
  }
  final zip = ZipDecoder().decodeBytes(bytes);
  if (zip.findFile('xl/workbook.xml') != null) {
    return ParseResult(sheets: xlsxToSheets(zip));
  }
  final content = zip.findFile('content.xml');
  if (content != null) {
    return ParseResult(sheets: odsToSheets(decodeBytes(content.content)));
  }
  return ParseResult(error: 'Could not read this spreadsheet.');
}

ParseResult _parseSlides(Uint8List bytes, String name) {
  final ext = fileExt(name);
  if (ext == 'ppt' || (bytes.length > 8 && bytes[0] == 0xD0 && bytes[1] == 0xCF)) {
    return ParseResult(text: extractPrintable(bytes), truncated: true);
  }
  final zip = ZipDecoder().decodeBytes(bytes);
  final slides = <String>[];
  final names = zip.files
      .where((f) => f.isFile && _slidePath(f.name))
      .map((f) => f.name)
      .toList()
    ..sort();
  for (final n in names) {
    final file = zip.findFile(n);
    if (file == null) continue;
    final text = slideXmlToText(decodeBytes(file.content));
    if (text.trim().isNotEmpty) slides.add(text);
  }
  if (slides.isEmpty) {
    final content = zip.findFile('content.xml');
    if (content != null) {
      final chunks = odpToSlides(decodeBytes(content.content));
      if (chunks.isNotEmpty) return ParseResult(slides: chunks);
    }
    return ParseResult(error: 'No slide text found.');
  }
  return ParseResult(slides: slides);
}

ParseResult _parseEpub(Uint8List bytes) {
  final zip = ZipDecoder().decodeBytes(bytes);
  final buf = StringBuffer();
  final htmlFiles = zip.files
      .where((f) => f.isFile && _isHtmlName(f.name))
      .map((f) => f.name)
      .toList()
    ..sort();
  var n = 0;
  for (final name in htmlFiles) {
    final file = zip.findFile(name);
    if (file == null) continue;
    final body = htmlToReadable(decodeBytes(file.content)).trim();
    if (body.isEmpty) continue;
    if (n > 0) buf.writeln('\n---\n');
    buf.writeln(body);
    n += 1;
    if (buf.length > maxTextBytes) {
      buf.writeln('\n\n… truncated');
      return ParseResult(text: buf.toString(), truncated: true);
    }
  }
  if (buf.isEmpty) return ParseResult(error: 'No readable chapters in this ebook.');
  return ParseResult(text: buf.toString());
}

ParseResult _parseArchive(Uint8List bytes, String name) {
  final ext = fileExt(name);
  Archive archive;
  if (ext == 'gz' || ext == 'tgz' || name.toLowerCase().endsWith('.tar.gz')) {
    final unzipped = GZipDecoder().decodeBytes(bytes);
    if (ext == 'tgz' || name.toLowerCase().endsWith('.tar.gz') || _looksLikeTar(unzipped)) {
      archive = TarDecoder().decodeBytes(unzipped);
    } else {
      return ParseResult(
        text: loadText(Uint8List.fromList(unzipped)).text,
        truncated: unzipped.length > maxTextBytes,
      );
    }
  } else if (ext == 'bz2') {
    final unzipped = BZip2Decoder().decodeBytes(bytes);
    if (_looksLikeTar(unzipped)) {
      archive = TarDecoder().decodeBytes(unzipped);
    } else {
      return ParseResult(text: loadText(Uint8List.fromList(unzipped)).text);
    }
  } else if (ext == 'tar') {
    archive = TarDecoder().decodeBytes(bytes);
  } else {
    archive = ZipDecoder().decodeBytes(bytes);
  }
  final entries = <ZipItem>[];
  var truncated = false;
  for (final f in archive) {
    if (entries.length >= maxZipEntries) {
      truncated = true;
      break;
    }
    entries.add(ZipItem(name: f.name, size: f.size, isFile: f.isFile));
  }
  entries.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return ParseResult(entries: entries, truncated: truncated);
}

Uint8List? extractZipEntry(Uint8List bytes, String entryName) {
  final zip = ZipDecoder().decodeBytes(bytes);
  final file = zip.findFile(entryName);
  if (file == null || !file.isFile) return null;
  return file.content;
}

bool _slidePath(String name) {
  final n = name.replaceAll('\\', '/').toLowerCase();
  return n.contains('ppt/slides/slide') && n.endsWith('.xml') && !n.contains('_rels');
}

bool _isHtmlName(String name) {
  final ext = fileExt(name);
  return htmlExts.contains(ext);
}

bool _looksLikeTar(List<int> bytes) {
  if (bytes.length < 262) return false;
  return bytes[257] == 0x75 && bytes[258] == 0x73 && bytes[259] == 0x74 && bytes[260] == 0x61 && bytes[261] == 0x72;
}

bool looksLikeRtf(Uint8List bytes) {
  if (bytes.length < 5) return false;
  final head = String.fromCharCodes(bytes.take(5));
  return head == '{\\rtf';
}

String unescapeXml(String s) {
  return s
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAllMapped(RegExp(r'&#x([0-9a-fA-F]+);'), (m) => String.fromCharCode(int.parse(m[1]!, radix: 16)))
      .replaceAllMapped(RegExp(r'&#(\d+);'), (m) => String.fromCharCode(int.parse(m[1]!)));
}

Iterable<String> xmlTagTexts(String xml, String localName) {
  final re = RegExp('<$localName(?:\\s[^>]*)?>([^<]*)</$localName>');
  return re.allMatches(xml).map((m) => unescapeXml(m[1] ?? ''));
}

String wordXmlToText(String xml) {
  final buf = StringBuffer();
  for (final para in xml.split(RegExp(r'</w:p>'))) {
    final parts = xmlTagTexts(para, 'w:t');
    final line = parts.join();
    if (line.trim().isEmpty) {
      if (buf.isNotEmpty) buf.writeln();
      continue;
    }
    buf.writeln(line);
  }
  return buf.toString().trim();
}

String odtToText(String xml) {
  final buf = StringBuffer();
  for (final para in xml.split(RegExp(r'</text:p>|<text:h[^>]*>|</text:h>'))) {
    final cleaned = para
        .replaceAll(RegExp(r'<text:line-break[^/]*/>'), '\n')
        .replaceAll(RegExp(r'<text:tab[^/]*/>'), '\t');
    final texts = RegExp(r'>([^<]+)<').allMatches(cleaned).map((m) => unescapeXml(m[1]!)).join();
    if (texts.trim().isNotEmpty) buf.writeln(texts.trim());
  }
  return buf.toString().trim();
}

String slideXmlToText(String xml) {
  final parts = xmlTagTexts(xml, 'a:t').map((s) => s.trim()).where((s) => s.isNotEmpty);
  return parts.join('\n');
}

List<String> odpToSlides(String xml) {
  final slides = <String>[];
  for (final chunk in xml.split(RegExp(r'<draw:page\b'))) {
    if (!chunk.contains('text:p') && !chunk.contains('text:span')) continue;
    final texts = RegExp(r'>([^<]+)<').allMatches(chunk).map((m) => unescapeXml(m[1]!).trim()).where((s) => s.isNotEmpty);
    final body = texts.join('\n').trim();
    if (body.isNotEmpty) slides.add(body);
  }
  return slides;
}

List<SheetData> xlsxToSheets(Archive zip) {
  final shared = <String>[];
  final ss = zip.findFile('xl/sharedStrings.xml');
  if (ss != null) {
    final xml = decodeBytes(ss.content);
    for (final si in xml.split(RegExp(r'</si>'))) {
      shared.add(xmlTagTexts(si, 't').join());
    }
  }
  final names = <String>[];
  final wb = zip.findFile('xl/workbook.xml');
  if (wb != null) {
    final re = RegExp(r'<sheet[^>]*name="([^"]+)"');
    for (final m in re.allMatches(decodeBytes(wb.content))) {
      names.add(unescapeXml(m[1]!));
    }
  }
  final sheetFiles = zip.files
      .where((f) => f.isFile && _isSheetPath(f.name))
      .map((f) => f.name)
      .toList()
    ..sort();
  final out = <SheetData>[];
  for (var i = 0; i < sheetFiles.length; i++) {
    final file = zip.findFile(sheetFiles[i]);
    if (file == null) continue;
    out.add(
      xlsxSheetToData(
        decodeBytes(file.content),
        names.length > i ? names[i] : 'Sheet ${i + 1}',
        shared,
      ),
    );
  }
  return out.isEmpty ? [SheetData(name: 'Sheet', rows: const [])] : out;
}

bool _isSheetPath(String name) {
  final n = name.replaceAll('\\', '/').toLowerCase();
  return n.startsWith('xl/worksheets/sheet') && n.endsWith('.xml') && !n.contains('_rels');
}

SheetData xlsxSheetToData(String xml, String name, List<String> shared) {
  final rows = <List<String>>[];
  var truncated = false;
  for (final rowXml in xml.split(RegExp(r'</row>'))) {
    if (!rowXml.contains('<c ')) continue;
    if (rows.length >= maxSheetRows) {
      truncated = true;
      break;
    }
    final cells = <int, String>{};
    var maxCol = 0;
    for (final m in RegExp(r'<c\b([^>]*)>([\s\S]*?)(?:</c>|$)').allMatches(rowXml)) {
      final attrs = m[1] ?? '';
      final body = m[2] ?? '';
      final ref = RegExp(r'r="([A-Z]+)(\d+)"').firstMatch(attrs);
      final col = ref != null ? colLettersToIndex(ref[1]!) : maxCol;
      final type = RegExp(r't="([^"]+)"').firstMatch(attrs)?[1];
      String value;
      if (type == 'inlineStr') {
        value = xmlTagTexts(body, 't').join();
      } else {
        final v = xmlTagTexts(body, 'v').join();
        if (type == 's') {
          final i = int.tryParse(v);
          value = (i != null && i >= 0 && i < shared.length) ? shared[i] : v;
        } else {
          value = v;
        }
      }
      cells[col] = value;
      if (col > maxCol) maxCol = col;
    }
    if (cells.isEmpty) continue;
    final width = (maxCol + 1).clamp(1, maxSheetCols);
    if (maxCol + 1 > maxSheetCols) truncated = true;
    rows.add([for (var c = 0; c < width; c++) cells[c] ?? '']);
  }
  return SheetData(name: name, rows: rows, truncated: truncated);
}

int colLettersToIndex(String letters) {
  var n = 0;
  for (final u in letters.codeUnits) {
    n = n * 26 + (u - 64);
  }
  return n - 1;
}

List<SheetData> odsToSheets(String xml) {
  final out = <SheetData>[];
  for (final table in xml.split(RegExp(r'<table:table\b'))) {
    final nameMatch = RegExp(r'table:name="([^"]+)"').firstMatch(table);
    if (nameMatch == null) continue;
    final rows = <List<String>>[];
    var truncated = false;
    for (final rowXml in table.split(RegExp(r'<table:table-row\b'))) {
      if (!rowXml.contains('table:table-cell')) continue;
      if (rows.length >= maxSheetRows) {
        truncated = true;
        break;
      }
      final cells = <String>[];
      for (final cell in RegExp(r'<table:table-cell\b([^>]*)>([\s\S]*?)(?:</table:table-cell>|$)').allMatches(rowXml)) {
        final attrs = cell[1] ?? '';
        final body = cell[2] ?? '';
        final repeat = int.tryParse(RegExp(r'table:number-columns-repeated="(\d+)"').firstMatch(attrs)?[1] ?? '') ?? 1;
        final value = xmlTagTexts(body, 'text:p').join(' ');
        for (var i = 0; i < repeat && cells.length < maxSheetCols; i++) {
          cells.add(value);
        }
        if (repeat > 1 && cells.length >= maxSheetCols) truncated = true;
      }
      if (cells.any((c) => c.isNotEmpty)) rows.add(cells);
    }
    out.add(SheetData(name: unescapeXml(nameMatch[1]!), rows: rows, truncated: truncated));
  }
  return out;
}

SheetData parseCsv(String text, {String name = 'Sheet'}) {
  final rows = <List<String>>[];
  var truncated = false;
  final delim = text.contains('\t') && fileExt(name) == 'tsv' ? '\t' : _guessDelim(text);
  for (final line in const LineSplitter().convert(text)) {
    if (rows.length >= maxSheetRows) {
      truncated = true;
      break;
    }
    if (line.isEmpty && rows.isEmpty) continue;
    final cols = _splitCsvLine(line, delim);
    if (cols.length > maxSheetCols) {
      truncated = true;
      rows.add(cols.sublist(0, maxSheetCols));
    } else {
      rows.add(cols);
    }
  }
  return SheetData(name: name, rows: rows, truncated: truncated);
}

String _guessDelim(String text) {
  final sample = text.substring(0, text.length > 2000 ? 2000 : text.length);
  final commas = RegExp(',').allMatches(sample).length;
  final semis = RegExp(';').allMatches(sample).length;
  final tabs = RegExp('\t').allMatches(sample).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis > commas) return ';';
  return ',';
}

List<String> _splitCsvLine(String line, String delim) {
  final out = <String>[];
  final buf = StringBuffer();
  var quoted = false;
  for (var i = 0; i < line.length; i++) {
    final ch = line[i];
    if (quoted) {
      if (ch == '"') {
        if (i + 1 < line.length && line[i + 1] == '"') {
          buf.write('"');
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        buf.write(ch);
      }
    } else if (ch == '"') {
      quoted = true;
    } else if (ch == delim) {
      out.add(buf.toString());
      buf.clear();
    } else {
      buf.write(ch);
    }
  }
  out.add(buf.toString());
  return out;
}

String rtfToText(String rtf) {
  final buf = StringBuffer();
  var i = 0;
  var skipDest = 0;
  while (i < rtf.length) {
    final ch = rtf[i];
    if (ch == r'\') {
      if (i + 1 >= rtf.length) break;
      final next = rtf[i + 1];
      if (next == r'\') {
        if (skipDest == 0) buf.write(r'\');
        i += 2;
      } else if (next == '{') {
        if (skipDest == 0) buf.write('{');
        i += 2;
      } else if (next == '}') {
        if (skipDest == 0) buf.write('}');
        i += 2;
      } else if (next == "'") {
        if (i + 3 < rtf.length) {
          final hex = rtf.substring(i + 2, i + 4);
          final n = int.tryParse(hex, radix: 16);
          if (n != null && skipDest == 0) buf.writeCharCode(n);
          i += 4;
        } else {
          i += 2;
        }
      } else if (RegExp(r'[a-zA-Z]').hasMatch(next)) {
        var j = i + 1;
        while (j < rtf.length && RegExp(r'[a-zA-Z]').hasMatch(rtf[j])) {
          j += 1;
        }
        final word = rtf.substring(i + 1, j);
        if (j < rtf.length && rtf[j] == '-') j += 1;
        while (j < rtf.length && RegExp(r'\d').hasMatch(rtf[j])) {
          j += 1;
        }
        if (j < rtf.length && rtf[j] == ' ') j += 1;
        if (skipDest == 0) {
          if (word == 'par' || word == 'line' || word == 'pard') buf.write('\n');
          if (word == 'tab') buf.write('\t');
        }
        if (word == '*' || word == 'fonttbl' || word == 'colortbl' || word == 'stylesheet' || word == 'info') {
          skipDest += 1;
        }
        i = j;
      } else {
        i += 2;
      }
    } else if (ch == '{') {
      i += 1;
    } else if (ch == '}') {
      if (skipDest > 0) skipDest -= 1;
      i += 1;
    } else {
      if (skipDest == 0 && ch != '\r') buf.write(ch);
      i += 1;
    }
  }
  return buf.toString().replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
}

String htmlToReadable(String html) {
  var s = html;
  s = s.replaceAll(RegExp(r'<script[\s\S]*?</script>', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'<style[\s\S]*?</style>', caseSensitive: false), '');
  s = s.replaceAllMapped(RegExp(r'<h1[^>]*>([\s\S]*?)</h1>', caseSensitive: false), (m) => '\n# ${_stripTags(m[1]!)}\n');
  s = s.replaceAllMapped(RegExp(r'<h2[^>]*>([\s\S]*?)</h2>', caseSensitive: false), (m) => '\n## ${_stripTags(m[1]!)}\n');
  s = s.replaceAllMapped(RegExp(r'<h3[^>]*>([\s\S]*?)</h3>', caseSensitive: false), (m) => '\n### ${_stripTags(m[1]!)}\n');
  s = s.replaceAllMapped(RegExp(r'<li[^>]*>([\s\S]*?)</li>', caseSensitive: false), (m) => '\n- ${_stripTags(m[1]!)}');
  s = s.replaceAllMapped(RegExp(r'<pre[^>]*>([\s\S]*?)</pre>', caseSensitive: false), (m) => '\n```\n${_stripTags(m[1]!)}\n```\n');
  s = s.replaceAllMapped(RegExp(r'<code[^>]*>([\s\S]*?)</code>', caseSensitive: false), (m) => '`${_stripTags(m[1]!)}`');
  s = s.replaceAllMapped(RegExp(r'<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', caseSensitive: false), (m) => '[${_stripTags(m[2]!)}](${m[1]})');
  s = s.replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'</p>', caseSensitive: false), '\n\n');
  s = s.replaceAll(RegExp(r'</div>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'</tr>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'</th>|</td>', caseSensitive: false), ' | ');
  s = _stripTags(s);
  s = unescapeXml(s);
  return s.replaceAll(RegExp(r'[ \t]+\n'), '\n').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
}

String _stripTags(String s) => s.replaceAll(RegExp(r'<[^>]+>'), '');

String extractPrintable(Uint8List bytes) {
  final ascii = StringBuffer();
  final run = StringBuffer();
  void flush() {
    if (run.length >= 5) {
      if (ascii.isNotEmpty) ascii.writeln();
      ascii.write(run);
    }
    run.clear();
  }

  for (final b in bytes) {
    if (b == 9 || b == 10 || b == 13 || (b >= 32 && b < 127)) {
      run.writeCharCode(b == 13 ? 10 : b);
    } else {
      flush();
    }
  }
  flush();
  if (ascii.length > 80) return ascii.toString().replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();

  final utf = StringBuffer();
  for (var i = 0; i + 1 < bytes.length; i += 2) {
    final c = bytes[i] | (bytes[i + 1] << 8);
    if (c == 9 || c == 10 || c == 13 || (c >= 32 && c < 0xD800)) {
      utf.writeCharCode(c == 13 ? 10 : c);
    } else {
      utf.write('\n');
    }
  }
  final cleaned = utf.toString().replaceAll(RegExp(r'[^\S\n]{2,}'), ' ').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
  return cleaned.isEmpty ? 'No readable text in this file.' : cleaned;
}

String hexDump(Uint8List bytes, {int limit = maxHexBytes}) {
  final n = bytes.length < limit ? bytes.length : limit;
  final buf = StringBuffer();
  for (var i = 0; i < n; i += 16) {
    buf.write(i.toRadixString(16).padLeft(8, '0'));
    buf.write('  ');
    final end = i + 16 < n ? i + 16 : n;
    for (var j = i; j < i + 16; j++) {
      if (j < end) {
        buf.write(bytes[j].toRadixString(16).padLeft(2, '0'));
      } else {
        buf.write('  ');
      }
      buf.write(j % 8 == 7 ? '  ' : ' ');
    }
    buf.write(' ');
    for (var j = i; j < end; j++) {
      final b = bytes[j];
      buf.write(b >= 32 && b < 127 ? String.fromCharCode(b) : '.');
    }
    buf.writeln();
  }
  if (bytes.length > n) buf.writeln('\n… ${formatBytes(bytes.length - n)} not shown');
  return buf.toString();
}
