import 'package:flutter/material.dart';

enum PreviewKind {
  image,
  svg,
  pdf,
  markdown,
  html,
  code,
  text,
  json,
  csv,
  document,
  spreadsheet,
  slides,
  epub,
  archive,
  video,
  audio,
  binary,
}

const imageExts = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'};

const markdownExts = {'md', 'markdown', 'mdown', 'mdx', 'rst'};

const markdownNames = {
  'readme',
  'changelog',
  'history',
  'contributing',
  'code_of_conduct',
  'authors',
  'license',
  'copying',
  'notice',
};

const htmlExts = {'html', 'htm', 'xhtml'};

const jsonExts = {'json', 'jsonl', 'ndjson', 'geojson', 'har'};

const csvExts = {'csv', 'tsv'};

const pdfExts = {'pdf'};

const svgExts = {'svg'};

const documentExts = {'docx', 'odt', 'rtf', 'doc'};

const sheetExts = {'xlsx', 'ods', 'xls'};

const slideExts = {'pptx', 'odp', 'ppt'};

const epubExts = {'epub'};

const archiveExts = {'zip', 'jar', 'apk', 'whl', 'nupkg', 'tar', 'tgz', 'gz', 'bz2'};

const videoExts = {'mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', '3gp'};

const audioExts = {'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'};

const textExts = {
  'txt',
  'log',
  'out',
  'err',
  'text',
  'nfo',
  'asc',
  'conf',
  'cfg',
  'ini',
  'env',
  'toml',
  'properties',
  'gitignore',
  'gitattributes',
  'dockerignore',
  'editorconfig',
  'npmrc',
  'nvmrc',
  'lock',
  'sum',
  'mod',
  'plist',
};

const codeLangByExt = <String, String>{
  'dart': 'dart',
  'js': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'py': 'python',
  'pyw': 'python',
  'go': 'go',
  'rs': 'rust',
  'java': 'java',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'swift': 'swift',
  'c': 'c',
  'h': 'c',
  'cc': 'cpp',
  'cpp': 'cpp',
  'cxx': 'cpp',
  'hpp': 'cpp',
  'hh': 'cpp',
  'cs': 'csharp',
  'rb': 'ruby',
  'php': 'php',
  'sh': 'bash',
  'bash': 'bash',
  'zsh': 'bash',
  'fish': 'bash',
  'ps1': 'powershell',
  'sql': 'sql',
  'css': 'css',
  'scss': 'scss',
  'less': 'less',
  'xml': 'xml',
  'xsl': 'xml',
  'xslt': 'xml',
  'svg': 'xml',
  'yaml': 'yaml',
  'yml': 'yaml',
  'gradle': 'gradle',
  'groovy': 'gradle',
  'proto': 'protobuf',
  'lua': 'lua',
  'r': 'r',
  'scala': 'scala',
  'pl': 'perl',
  'pm': 'perl',
  'ex': 'elixir',
  'exs': 'elixir',
  'erl': 'erlang',
  'hs': 'haskell',
  'vim': 'vim',
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'mk': 'makefile',
  'cmake': 'cmake',
  'vue': 'xml',
  'svelte': 'xml',
  'tf': 'plaintext',
};

const textNames = {
  'makefile',
  'dockerfile',
  'gemfile',
  'rakefile',
  'procfile',
  'jenkinsfile',
  'vagrantfile',
  'brewfile',
  'podfile',
};

String fileBaseName(String? name) {
  if (name == null || name.isEmpty) return '';
  final cleaned = name.split('?').first.replaceAll('\\', '/');
  return cleaned.split('/').last;
}

String fileExt(String? name) {
  final base = fileBaseName(name);
  final i = base.lastIndexOf('.');
  if (i <= 0 || i == base.length - 1) return '';
  return base.substring(i + 1).toLowerCase();
}

String fileStem(String? name) {
  final base = fileBaseName(name);
  final i = base.lastIndexOf('.');
  if (i <= 0) return base.toLowerCase();
  return base.substring(0, i).toLowerCase();
}

PreviewKind detectPreviewKind({String? name, String? mime, String? kind}) {
  final m = mime?.toLowerCase() ?? '';
  if (kind == 'photo' || m.startsWith('image/')) {
    if (m.contains('svg') || fileExt(name) == 'svg') return PreviewKind.svg;
    return PreviewKind.image;
  }
  if (m == 'application/pdf' || m.endsWith('/pdf')) return PreviewKind.pdf;
  if (m.startsWith('video/')) return PreviewKind.video;
  if (m.startsWith('audio/')) return PreviewKind.audio;
  if (m == 'text/markdown' || m == 'text/x-markdown') return PreviewKind.markdown;
  if (m == 'text/html' || m == 'application/xhtml+xml') return PreviewKind.html;
  if (m == 'application/json' || m.endsWith('+json')) return PreviewKind.json;
  if (m == 'text/csv' || m == 'text/tab-separated-values') return PreviewKind.csv;
  if (m.contains('wordprocessingml') || m.contains('opendocument.text') || m == 'application/rtf') {
    return PreviewKind.document;
  }
  if (m.contains('spreadsheetml') || m.contains('opendocument.spreadsheet')) {
    return PreviewKind.spreadsheet;
  }
  if (m.contains('presentationml') || m.contains('opendocument.presentation')) {
    return PreviewKind.slides;
  }
  if (m.contains('epub')) return PreviewKind.epub;
  if (m.contains('zip') || m.contains('gzip') || m.contains('x-tar')) return PreviewKind.archive;

  final ext = fileExt(name);
  final stem = fileStem(name);
  final base = fileBaseName(name).toLowerCase();

  if (imageExts.contains(ext)) return PreviewKind.image;
  if (svgExts.contains(ext)) return PreviewKind.svg;
  if (pdfExts.contains(ext)) return PreviewKind.pdf;
  if (markdownExts.contains(ext) || markdownNames.contains(base) || markdownNames.contains(stem)) {
    return PreviewKind.markdown;
  }
  if (htmlExts.contains(ext)) return PreviewKind.html;
  if (jsonExts.contains(ext)) return PreviewKind.json;
  if (csvExts.contains(ext)) return PreviewKind.csv;
  if (documentExts.contains(ext)) return PreviewKind.document;
  if (sheetExts.contains(ext)) return PreviewKind.spreadsheet;
  if (slideExts.contains(ext)) return PreviewKind.slides;
  if (epubExts.contains(ext)) return PreviewKind.epub;
  if (archiveExts.contains(ext)) return PreviewKind.archive;
  if (videoExts.contains(ext)) return PreviewKind.video;
  if (audioExts.contains(ext)) return PreviewKind.audio;
  if (codeLangByExt.containsKey(ext) || codeLangByExt.containsKey(base)) return PreviewKind.code;
  if (textExts.contains(ext) || textNames.contains(base) || m.startsWith('text/')) {
    return PreviewKind.text;
  }
  return PreviewKind.binary;
}

String? highlightLanguage(String? name) {
  final ext = fileExt(name);
  if (codeLangByExt.containsKey(ext)) return codeLangByExt[ext];
  final base = fileBaseName(name).toLowerCase();
  return codeLangByExt[base];
}

String kindLabel(PreviewKind kind) {
  return switch (kind) {
    PreviewKind.image => 'Image',
    PreviewKind.svg => 'SVG',
    PreviewKind.pdf => 'PDF',
    PreviewKind.markdown => 'Markdown',
    PreviewKind.html => 'HTML',
    PreviewKind.code => 'Code',
    PreviewKind.text => 'Text',
    PreviewKind.json => 'JSON',
    PreviewKind.csv => 'CSV',
    PreviewKind.document => 'Document',
    PreviewKind.spreadsheet => 'Spreadsheet',
    PreviewKind.slides => 'Slides',
    PreviewKind.epub => 'Ebook',
    PreviewKind.archive => 'Archive',
    PreviewKind.video => 'Video',
    PreviewKind.audio => 'Audio',
    PreviewKind.binary => 'File',
  };
}

IconData kindIcon(PreviewKind kind) {
  return switch (kind) {
    PreviewKind.image => Icons.image_outlined,
    PreviewKind.svg => Icons.polyline_outlined,
    PreviewKind.pdf => Icons.picture_as_pdf_outlined,
    PreviewKind.markdown => Icons.article_outlined,
    PreviewKind.html => Icons.language,
    PreviewKind.code => Icons.code,
    PreviewKind.text => Icons.notes_outlined,
    PreviewKind.json => Icons.data_object,
    PreviewKind.csv => Icons.table_chart_outlined,
    PreviewKind.document => Icons.description_outlined,
    PreviewKind.spreadsheet => Icons.grid_on_outlined,
    PreviewKind.slides => Icons.slideshow_outlined,
    PreviewKind.epub => Icons.menu_book_outlined,
    PreviewKind.archive => Icons.folder_zip_outlined,
    PreviewKind.video => Icons.movie_outlined,
    PreviewKind.audio => Icons.audiotrack_outlined,
    PreviewKind.binary => Icons.insert_drive_file_outlined,
  };
}

String formatBytes(int n) {
  if (n < 1024) return '$n B';
  if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(1)} KB';
  if (n < 1024 * 1024 * 1024) return '${(n / (1024 * 1024)).toStringAsFixed(1)} MB';
  return '${(n / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
}
