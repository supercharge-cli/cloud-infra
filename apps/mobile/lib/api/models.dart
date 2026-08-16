class AuthUser {
  AuthUser({required this.id, required this.email, this.role});
  final String id;
  final String email;
  final String? role;

  factory AuthUser.fromJson(Map<String, dynamic> j) => AuthUser(
        id: '${j['id'] ?? ''}',
        email: '${j['email'] ?? ''}',
        role: j['role'] as String?,
      );
}

class CloudInstance {
  CloudInstance({
    required this.id,
    required this.name,
    required this.status,
    this.liveState,
    this.sandboxId,
    this.paid = true,
    this.isFree = false,
    this.lastError,
  });
  final String id;
  final String name;
  final String status;
  final String? liveState;
  final String? sandboxId;
  final bool paid;
  final bool isFree;
  final String? lastError;

  String get displayState => liveState ?? status;

  factory CloudInstance.fromJson(Map<String, dynamic> j) => CloudInstance(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? 'workspace'}',
        status: '${j['status'] ?? ''}',
        liveState: j['liveState'] as String?,
        sandboxId: j['sandboxId'] as String?,
        paid: j['paid'] != false,
        isFree: j['isFree'] == true,
        lastError: j['lastError'] as String?,
      );
}

class AppChatEvent {
  AppChatEvent(this.raw);
  final Map<String, dynamic> raw;
  String get id => '${raw['id'] ?? ''}';
  String get type => '${raw['type'] ?? ''}';
  String get text => '${raw['text'] ?? raw['summary'] ?? raw['detail'] ?? raw['question'] ?? ''}';
  String? get ref => raw['ref'] as String? ?? raw['id'] as String?;
  String? get fileId => raw['fileId'] as String?;
  String? get name => raw['name'] as String?;
  String? get kind => raw['kind'] as String?;
  List<String> get choices =>
      (raw['choices'] as List?)?.map((e) => '$e').toList() ?? const [];
  List<Map<String, dynamic>> get options =>
      (raw['options'] as List?)
          ?.whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList() ??
      const [];
}

class BotCommand {
  BotCommand({required this.command, required this.description});
  final String command;
  final String description;
}
