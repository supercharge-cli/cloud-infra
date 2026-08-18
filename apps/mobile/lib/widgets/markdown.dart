import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme.dart';

MarkdownStyleSheet chatMarkdownSheet(BuildContext context) {
  return MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
    p: const TextStyle(color: Colors.white, height: 1.55, fontSize: 16),
    h1: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 22, height: 1.3),
    h2: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 19, height: 1.3),
    h3: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 16, height: 1.3),
    h4: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 15),
    strong: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white),
    em: const TextStyle(fontStyle: FontStyle.italic, color: Colors.white),
    a: const TextStyle(color: Vc.green, decoration: TextDecoration.underline),
    code: const TextStyle(
      backgroundColor: Color(0xFF18181B),
      color: Color(0xFFBBF7D0),
      fontFamily: 'monospace',
      fontSize: 13,
    ),
    codeblockDecoration: BoxDecoration(
      color: const Color(0xFF18181B),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: Vc.cardBorder),
    ),
    codeblockPadding: const EdgeInsets.all(12),
    blockquoteDecoration: const BoxDecoration(
      color: Color(0xFF111113),
      border: Border(left: BorderSide(color: Vc.green, width: 3)),
    ),
    blockquotePadding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
    listBullet: const TextStyle(color: Vc.green, fontSize: 15),
    tableHead: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white),
    tableBody: const TextStyle(color: Colors.white, fontSize: 13),
    tableBorder: TableBorder.all(color: Vc.cardBorder, width: 0.6),
    horizontalRuleDecoration: const BoxDecoration(
      border: Border(top: BorderSide(color: Vc.cardBorder)),
    ),
  );
}

class ChatMarkdown extends StatelessWidget {
  const ChatMarkdown({
    super.key,
    required this.data,
    this.soft = false,
    this.onTapHref,
  });
  final String data;
  final bool soft;
  final bool Function(String href)? onTapHref;

  @override
  Widget build(BuildContext context) {
    if (data.trim().isEmpty) return const SizedBox.shrink();
    return MarkdownBody(
      data: data,
      selectable: true,
      styleSheet: chatMarkdownSheet(context).copyWith(
        p: TextStyle(
          color: Colors.white,
          height: 1.55,
          fontSize: soft ? 13 : 16,
        ),
      ),
      onTapLink: (text, href, title) {
        if (href == null) return;
        if (onTapHref != null && onTapHref!(href)) return;
        launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
      },
    );
  }
}