import '../files/kinds.dart' show fileExt, imageExts;

enum AgentRuntime { xibecode, supercharge }

extension AgentRuntimeApi on AgentRuntime {
  String get apiValue => name;

  String get label => this == AgentRuntime.supercharge ? 'Supercharge' : 'Workspace';

  static AgentRuntime parse(Object? raw) =>
      '$raw'.toLowerCase() == 'supercharge' ? AgentRuntime.supercharge : AgentRuntime.xibecode;
}

class CreateInstanceRequest {
  const CreateInstanceRequest({
    required this.name,
    this.runtime = AgentRuntime.supercharge,
    this.paid = false,
    this.planId = 'hosting-4c8g',
  });
  final String name;
  final AgentRuntime runtime;
  final bool paid;
  final String planId;
}

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
  bool get canCreateFree => available > 0;
  factory FreeQuota.fromJson(Map<String, dynamic>? j) {
    if (j == null) return FreeQuota();
    final limit = (j['limit'] as num?)?.toInt() ?? 1;
    final used = (j['used'] as num?)?.toInt() ?? 0;
    final available = (j['available'] as num?)?.toInt() ?? (limit - used);
    return FreeQuota(limit: limit, used: used, available: available);
  }
}

class CurrencyPrice {
  CurrencyPrice({this.priceLabel, this.buttonLabel, this.display});
  final String? priceLabel;
  final String? buttonLabel;
  final num? display;
  factory CurrencyPrice.fromJson(Map<String, dynamic>? j) {
    if (j == null) return CurrencyPrice();
    return CurrencyPrice(
      priceLabel: j['priceLabel'] as String?,
      buttonLabel: j['buttonLabel'] as String?,
      display: j['display'] as num?,
    );
  }
}

class PlanInfo {
  PlanInfo({
    this.label,
    this.priceInr,
    this.priceUsd,
    this.periodDays,
    this.inr,
    this.usd,
  });
  final String? label;
  final num? priceInr;
  final num? priceUsd;
  final num? periodDays;
  final CurrencyPrice? inr;
  final CurrencyPrice? usd;

  String get inrLabel => inr?.priceLabel ?? (priceInr != null ? '₹$priceInr/mo' : 'INR');
  String get usdLabel => usd?.priceLabel ?? (priceUsd != null ? '\$$priceUsd/mo' : 'USD');
  String get inrButton => inr?.buttonLabel ?? 'Pay in INR';
  String get usdButton => usd?.buttonLabel ?? 'Pay in USD';

  factory PlanInfo.fromJson(Map<String, dynamic>? j) {
    if (j == null) return PlanInfo();
    final currencies = j['currencies'] as Map<String, dynamic>?;
    return PlanInfo(
      label: j['label'] as String? ?? j['name'] as String?,
      priceInr: j['priceInr'] as num?,
      priceUsd: j['priceUsd'] as num?,
      periodDays: j['periodDays'] as num?,
      inr: CurrencyPrice.fromJson(currencies?['INR'] as Map<String, dynamic>?),
      usd: CurrencyPrice.fromJson(currencies?['USD'] as Map<String, dynamic>?),
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
    this.paidUntil,
    this.runtime = AgentRuntime.xibecode,
    this.subscriptionStatus,
    this.nextChargeAt,
    this.cancelAtCycleEnd = false,
    this.graceUntil,
    this.billingSuspendedAt,
    this.retainUntil,
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
  final String? paidUntil;
  final AgentRuntime runtime;
  /// Razorpay autopay status (active, pending, halted, paused, cancelled, …).
  final String? subscriptionStatus;
  final String? nextChargeAt;
  final bool cancelAtCycleEnd;
  final String? graceUntil;
  final String? billingSuspendedAt;
  final String? retainUntil;

  String get runtimeLabel => runtime.label;
  bool get billingSuspended => billingSuspendedAt != null && billingSuspendedAt!.isNotEmpty;
  bool get paymentFailed =>
      subscriptionStatus == 'pending' || subscriptionStatus == 'halted' || billingStatus == 'grace';

  /// One-line billing summary for lists and the billing screen.
  String? get billingSummary {
    if (isFree && subscriptionStatus == null) return null;
    if (billingSuspended) return 'Paused for billing · files kept until ${shortDate(retainUntil)}';
    if (paymentFailed) return 'Payment failed · retrying until ${shortDate(graceUntil ?? paidUntil)}';
    if (subscriptionStatus == 'active' && !cancelAtCycleEnd) {
      return 'Autopay on · next charge ${shortDate(nextChargeAt ?? paidUntil)}';
    }
    if (subscriptionStatus == 'active' && cancelAtCycleEnd) {
      return 'Autopay cancelled · access until ${shortDate(paidUntil)}';
    }
    if (subscriptionStatus == 'authenticated') return 'Autopay approved · first charge ${shortDate(nextChargeAt ?? paidUntil)}';
    if (subscriptionStatus == 'paused') return 'Autopay paused · access until ${shortDate(paidUntil)}';
    if (paidUntil != null && paidUntil!.isNotEmpty) return 'Paid until ${shortDate(paidUntil)}';
    return null;
  }

  String get displayState => liveState ?? status;
  bool get isPaused => displayState.toLowerCase() == 'paused';
  bool get isRunning => displayState.toLowerCase() == 'running';
  bool get needsPayment => !isFree && paid == false;
  bool get pastDue => billingStatus == 'past_due' || billingStatus == 'suspended' || needsPayment;

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
        paidUntil: j['paidUntil'] as String?,
        runtime: AgentRuntimeApi.parse(j['runtime']),
        subscriptionStatus: j['subscriptionStatus'] as String?,
        nextChargeAt: j['nextChargeAt'] as String?,
        cancelAtCycleEnd: j['cancelAtCycleEnd'] == true,
        graceUntil: j['graceUntil'] as String?,
        billingSuspendedAt: j['billingSuspendedAt'] as String?,
        retainUntil: j['retainUntil'] as String?,
      );
}

/// `2026-12-19T…Z` → `19 Dec 2026` (local time).
String shortDate(String? iso) {
  final d = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

class DashboardData {
  DashboardData({required this.instances, required this.quota, this.plan});
  final List<CloudInstance> instances;
  final FreeQuota quota;
  final PlanInfo? plan;
}

bool looksLikeImage({String? name, String? mime, String? kind}) {
  if (kind == 'photo') return true;
  if (mime != null && mime.toLowerCase().startsWith('image/')) {
    return !mime.toLowerCase().contains('svg');
  }
  return imageExts.contains(fileExt(name));
}

class AppChatEvent {
  AppChatEvent(this.raw, {this.local = false});
  final Map<String, dynamic> raw;
  final bool local;

  factory AppChatEvent.fromJson(Map<String, dynamic> j) {
    final local = j['_local'] == true;
    final raw = Map<String, dynamic>.from(j)..remove('_local');
    return AppChatEvent(raw, local: local);
  }

  Map<String, dynamic> toJson() => {...raw, if (local) '_local': true};

  String get id => '${raw['id'] ?? ''}';
  String get type => '${raw['type'] ?? ''}';
  String get text =>
      '${raw['text'] ?? raw['summary'] ?? raw['detail'] ?? raw['question'] ?? raw['caption'] ?? ''}';
  String? get ref {
    final value = raw['ref'] ?? raw['id'];
    return value == null ? null : '$value';
  }
  String? get fileId => raw['fileId'] as String?;
  String? get name => raw['name'] as String?;
  String? get kind => raw['kind'] as String?;
  String? get title => raw['title'] as String?;
  String? get state => raw['state'] as String?;
  String? get tab => raw['tab'] as String?;
  String? get command => raw['command'] as String?;
  String? get action => raw['action'] as String?;
  String? get target => raw['target'] as String?;
  String? get stdout => raw['stdout'] as String?;
  String? get label => raw['label'] as String?;
  bool get focus => raw['focus'] == true;
  int? get exitCode => (raw['exitCode'] as num?)?.toInt();
  bool? get success {
    final v = raw['success'];
    if (v is bool) return v;
    return null;
  }
  String? get mime => raw['mime'] as String?;
  String? get localPath => raw['localPath'] as String?;
  String? get url => raw['url'] as String?;
  String? get role => raw['role'] as String?;
  int get ts => (raw['ts'] as num?)?.toInt() ?? 0;
  int? get size => (raw['size'] as num?)?.toInt();
  int? get tools => (raw['tools'] as num?)?.toInt();
  int? get elapsedMs => (raw['elapsedMs'] as num?)?.toInt();
  int? get etaMs => (raw['etaMs'] as num?)?.toInt();
  int? get pct => (raw['pct'] as num?)?.toInt();
  int? get used => (raw['used'] as num?)?.toInt();
  int? get max => (raw['max'] as num?)?.toInt();
  String? get modelId => raw['model'] as String?;
  bool? get busy {
    final v = raw['busy'];
    if (v is bool) return v;
    return null;
  }
  int? get startedAt => (raw['startedAt'] as num?)?.toInt();
  String? get lastTool => raw['lastTool'] as String?;
  bool get isFinal => raw['final'] == true;
  bool get isUser => local || type == 'user' || role == 'user';
  bool get isImage => looksLikeImage(name: name, mime: mime, kind: kind);
  bool get isTerminal => type == 'done' || type == 'error';
  String? get sessionId {
    final v = '${raw['sessionId'] ?? ''}'.trim();
    return v.isEmpty ? null : v;
  }
  String? get previousSessionId {
    final v = '${raw['previousSessionId'] ?? ''}'.trim();
    return v.isEmpty ? null : v;
  }
  List<Map<String, dynamic>> get conversations =>
      (raw['conversations'] as List?)
          ?.whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList() ??
      const [];

  void setLocalPath(String path) => raw['localPath'] = path;

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
  const BotCommand({required this.command, required this.description});
  final String command;
  final String description;

  /// Display/send form — always exactly one leading slash.
  String get slash {
    var name = command.trim();
    while (name.startsWith('/')) {
      name = name.substring(1);
    }
    return '/$name';
  }

  /// Command name without any leading slashes.
  String get name => slash.substring(1);
}

class ExecResult {
  ExecResult({
    this.ok = false,
    this.exitCode,
    this.stdout = '',
    this.stderr = '',
    this.cwd,
    this.command,
  });
  final bool ok;
  final int? exitCode;
  final String stdout;
  final String stderr;
  final String? cwd;
  final String? command;
  factory ExecResult.fromJson(Map<String, dynamic> j, {String? command}) => ExecResult(
        ok: j['ok'] == true,
        exitCode: (j['exitCode'] as num?)?.toInt(),
        stdout: '${j['stdout'] ?? ''}',
        stderr: '${j['stderr'] ?? j['message'] ?? ''}',
        cwd: j['cwd'] as String?,
        command: command,
      );
}

class BillingArgs {
  const BillingArgs({
    this.instanceId,
    this.name,
    this.runtime = AgentRuntime.supercharge,
    this.planId = 'hosting-4c8g',
  });
  final String? instanceId;
  final String? name;
  final AgentRuntime runtime;
  final String planId;
  bool get renew => instanceId != null && instanceId!.isNotEmpty;
}

class WorkspaceEntry {
  WorkspaceEntry({required this.name, required this.type, this.size = 0});
  final String name;
  final String type;
  final int size;
  bool get isDir => type == 'directory' || type == 'dir';

  factory WorkspaceEntry.fromJson(Map<String, dynamic> j) => WorkspaceEntry(
        name: '${j['name'] ?? ''}',
        type: '${j['type'] ?? 'file'}',
        size: (j['size'] as num?)?.toInt() ?? 0,
      );
}

class DownloadedFile {
  DownloadedFile({required this.bytes, required this.name, this.mime});
  final List<int> bytes;
  final String name;
  final String? mime;
}
