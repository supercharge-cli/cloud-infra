class BotProfile {
  const BotProfile({
    required this.id,
    required this.name,
    required this.icon,
    required this.instructions,
    required this.defaultFolder,
    required this.revision,
  });

  final String id;
  final String name;
  final String icon;
  final String instructions;
  final String defaultFolder;
  final int revision;
  bool get isMain => id == 'main';
  bool get isImage => icon.startsWith('data:image/');

  factory BotProfile.fromJson(Map<String, dynamic> raw) => BotProfile(
    id: '${raw['id'] ?? ''}',
    name: '${raw['name'] ?? 'Bot'}',
    icon: '${raw['icon'] ?? '🤖'}',
    instructions: '${raw['instructions'] ?? ''}',
    defaultFolder: '${raw['defaultFolder'] ?? '/home/user/workspace'}',
    revision: (raw['revision'] as num?)?.toInt() ?? 1,
  );
}
