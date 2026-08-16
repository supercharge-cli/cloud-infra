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

class FreeQuota {
  FreeQuota({this.limit = 1, this.used = 0, this.available = 1});
  final int limit;
  final int used;
  final int available;
  factory FreeQuota.fromJson(Map<String, dynamic>? j) {
    if (j == null) return FreeQuota();
    final limit = (j['limit'] as num?)?.toInt() ?? 1;
    final used = (j['used'] as num?)?.toInt() ?? 0;
    final available = (j['available'] as num?)?.toInt() ?? (limit - used);
    return FreeQuota(limit: limit, used: used, available: available);
  }
}

class PlanInfo {
  PlanInfo({this.label, this.priceInr, this.priceUsd, this.periodDays});
  final String? label;
  final num? priceInr;
  final num? priceUsd;
  final num? periodDays;
  factory PlanInfo.fromJson(Map<String, dynamic>? j) {
    if (j == null) return PlanInfo();
    return PlanInfo(
      label: j['label'] as String? ?? j['name'] as String?,
      priceInr: j['priceInr'] as num?,
      priceUsd: j['priceUsd'] as num?,
      periodDays: j['periodDays'] as num?,
    );
  }
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
    this.resumable = true,
    this.billingStatus,
    this.liveMessage,
  });
  final String id;
  final String name;
  final String status;
  final String? liveState;
  final String? sandboxId;
  final bool paid;
  final bool isFree;
  final String? lastError;
  final bool resumable;
  final String? billingStatus;
  final String? liveMessage;

  String get displayState => liveState ?? status;
  bool get isPaused => displayState.toLowerCase() == 'paused';
  bool get isRunning => displayState.toLowerCase() == 'running';

  factory CloudInstance.fromJson(Map<String, dynamic> j) => CloudInstance(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? 'workspace'}',
        status: '${j['status'] ?? ''}',
        liveState: j['liveState'] as String?,
        sandboxId: j['sandboxId'] as String?,
        paid: j['paid'] != false,
        isFree: j['isFree'] == true,
        lastError: j['lastError'] as String?,
        resumable: j['resumable'] != false,
        billingStatus: j['billingStatus'] as String?,
        liveMessage: j['liveMessage'] as String?,
      );
}

class DashboardData {
  DashboardData({required this.instances, required this.quota, this.plan});
  final List<CloudInstance> instances;
  final FreeQuota quota;
  final PlanInfo? plan;
}

class AppChatEvent {
  AppChatEvent(this.raw, {this.local = false});
  final Map<String, dynamic> raw;
  final bool local;
  String get id => '${raw['id'] ?? ''}';
  String get type => '${raw['type'] ?? ''}';
  String get text =>
      '${raw['text'] ?? raw['summary'] ?? raw['detail'] ?? raw['question'] ?? ''}';
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

class ExecResult {
  ExecResult({this.ok = false, this.exitCode, this.stdout = '', this.stderr = '', this.cwd});
  final bool ok;
  final int? exitCode;
  final String stdout;
  final String stderr;
  final String? cwd;
  factory ExecResult.fromJson(Map<String, dynamic> j) => ExecResult(
        ok: j['ok'] == true,
        exitCode: (j['exitCode'] as num?)?.toInt(),
        stdout: '${j['stdout'] ?? ''}',
        stderr: '${j['stderr'] ?? j['message'] ?? ''}',
        cwd: j['cwd'] as String?,
      );
}
