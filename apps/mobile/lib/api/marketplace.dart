import 'package:flutter/material.dart';

Map<String, dynamic> marketplaceMap(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};

List<Map<String, dynamic>> marketplaceRows(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList()
    : [];

List<String> marketplaceStrings(Object? value) =>
    value is List ? value.whereType<String>().toList() : [];

class MarketplacePlugin {
  MarketplacePlugin(this.catalog, {this.installed});

  final Map<String, dynamic> catalog;
  final Map<String, dynamic>? installed;
  Map<String, dynamic> get manifest => marketplaceMap(installed?['manifest']);
  String get id => '${installed?['id'] ?? catalog['id'] ?? ''}';
  String get name => '${manifest['name'] ?? catalog['name'] ?? id}';
  String get version =>
      '${manifest['version'] ?? catalog['version'] ?? 'Unknown'}';
  String get description =>
      '${manifest['description'] ?? catalog['description'] ?? 'No description provided.'}';
  String get publisher =>
      _label(catalog['publisher'], 'Publisher not provided');
  String get category => _label(catalog['category'], 'Uncategorized');
  String get auth => _label(catalog['auth'], 'unspecified');
  List<String> get capabilities => marketplaceStrings(catalog['capabilities']);
  bool get supportsVm =>
      !catalog.containsKey('targets') ||
      marketplaceStrings(catalog['targets']).contains('supercharge-e2b');
  bool get reviewedInstallation => installed == null ||
      (id == 'vectra-echo' &&
          version == '1.0.0' &&
          installed?['activeDigest'] ==
              'e1288de348eab757a0c5f0dd4580a371d02850470abfc0466af067b672f9081a');
  bool get authenticationSupported =>
      auth == 'none' ||
      auth == 'unspecified' ||
      (auth == 'secrets' && config.isNotEmpty);
  List<String> get permissions => marketplaceStrings(manifest['permissions']);
  Map<String, dynamic> get config => marketplaceMap(manifest['userConfig']);
  List<String> get configuredKeys =>
      marketplaceStrings(installed?['configuredKeys']);
  List<String> get servers =>
      marketplaceMap(manifest['mcpServers']).keys.toList();
  bool get reviewable =>
      installed?['revision'] is int &&
      manifest['permissions'] is List &&
      (manifest['permissions'] as List).every((item) => item is String);
  bool get trusted => installed?['trusted'] == true;
  bool get enabled => installed?['enabled'] == true;
  List<String> get missingConfiguration => config.entries
      .where(
        (entry) =>
            marketplaceMap(entry.value)['required'] == true &&
            !configuredKeys.contains(entry.key),
      )
      .map((entry) => entry.key)
      .toList();
  String? get digest {
    final source = marketplaceMap(catalog['source']);
    final digest = source['sha256'];
    return source['type'] == 'archive' &&
            digest is String &&
            RegExp(r'^[a-fA-F0-9]{64}$').hasMatch(digest)
        ? digest
        : null;
  }

  // Catalog URLs are never fetched as images; unknown artwork stays local.
  IconData get icon =>
      id == 'vectra-echo' ? Icons.graphic_eq : Icons.extension_outlined;

  bool matches(String query) => [
    name,
    publisher,
    description,
    category,
    ...capabilities,
  ].join(' ').toLowerCase().contains(query.trim().toLowerCase());

  static String _label(Object? value, String fallback) =>
      value is String && value.trim().isNotEmpty ? value.trim() : fallback;
}
