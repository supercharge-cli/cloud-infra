import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../desktop.dart';
import '../desktop/native.dart';
import '../desktop/shortcuts.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key, this.args});
  final BillingArgs? args;

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  Map<String, dynamic>? cfg;
  PlanInfo plan = PlanInfo();
  String? error;
  bool loading = true;
  bool busy = false;
  Razorpay? _rzp;
  CloudInstance? instance;

  BillingArgs get args => widget.args ?? const BillingArgs();

  @override
  void initState() {
    super.initState();
    if (!isDesktop) {
      _rzp = Razorpay();
      _rzp!.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onSuccess);
      _rzp!.on(Razorpay.EVENT_PAYMENT_ERROR, _onError);
    }
    _load();
  }

  @override
  void dispose() {
    _rzp?.clear();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final client = context.read<SessionController>().client;
      cfg = await client.billingConfig();
      plan = PlanInfo.fromJson(cfg?['plan'] as Map<String, dynamic>?);
      if (args.renew) {
        final list = await client.instances();
        instance = list.where((i) => i.id == args.instanceId).firstOrNull;
      }
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _pay(String currency) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final session = context.read<SessionController>();
      final order = await session.client.createOrder(
        purpose: args.renew ? 'renew' : 'new_instance',
        instanceId: args.instanceId,
        name: args.name,
        currency: currency,
        runtime: args.runtime,
        planId: args.planId,
      );
      final options = <String, dynamic>{
        'key': order['keyId'],
        'amount': order['amount'],
        'currency': order['currency'] ?? currency,
        'name': 'Vectra Cloud',
        'description': args.renew
            ? 'Renew ${args.instanceId}'
            : 'New instance ${args.name ?? ''}',
        'order_id': order['orderId'],
        'prefill': {'email': session.user?.email ?? ''},
        'theme': {'color': '#22C55E'},
      };
      if (isDesktop) {
        final result = await DesktopNative.checkout(options);
        if (!mounted) return;
        if (result?['error'] != null) throw StateError('${result!['error']}');
        if (result != null && result['cancelled'] != true) {
          final verified = await session.client.verifyPayment(
            orderId: '${result['razorpay_order_id'] ?? ''}',
            paymentId: '${result['razorpay_payment_id'] ?? ''}',
            signature: '${result['razorpay_signature'] ?? ''}',
          );
          if (!mounted) return;
          final instance = verified['instance'];
          if (instance is Map && instance['id'] != null) {
            final created = CloudInstance.fromJson(
              Map<String, dynamic>.from(instance),
            );
            context.go('/chat/${created.id}', extra: created);
          } else {
            context.go('/');
          }
        }
      } else {
        _rzp!.open(options);
      }
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => busy = false);
  }

  /// Autopay is set up for this size on the server (plan id configured).
  bool get _autopayForSize {
    final plans = cfg?['plans'];
    if (plans is! List) return false;
    final want = args.planId;
    return plans.any((p) => p is Map && p['id'] == want && p['autopay'] == true);
  }

  /// Subscriptions (start, change size, cancel) are managed on the web dashboard.
  Future<void> _openWebBilling() async {
    final base = context.read<SessionController>().client.baseUrl;
    final q = args.instanceId == null ? 'billing=1' : 'selected=${Uri.encodeQueryComponent(args.instanceId!)}&billing=1';
    await launchUrl(Uri.parse('$base/dashboard?$q'), mode: LaunchMode.externalApplication);
  }

  Future<void> _onSuccess(PaymentSuccessResponse res) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final api = context.read<SessionController>().client;
      final verified = await api.verifyPayment(
        orderId: res.orderId ?? '',
        paymentId: res.paymentId ?? '',
        signature: res.signature ?? '',
      );
      if (!mounted) return;
      final instMap = verified['instance'];
      if (instMap is Map && instMap['id'] != null) {
        final inst = CloudInstance.fromJson(Map<String, dynamic>.from(instMap));
        context.go('/chat/${inst.id}', extra: inst);
        return;
      }
      context.go('/');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        busy = false;
        error = e.toString();
      });
    }
  }

  void _onError(PaymentFailureResponse res) {
    if (!mounted) return;
    setState(() {
      busy = false;
      error = res.message ?? 'Payment cancelled';
    });
  }

  @override
  Widget build(BuildContext context) {
    final title = args.renew
        ? 'Renew instance'
        : (args.name == null ? 'Billing' : 'Pay & create');
    return AppScaffold(
      currentInstanceId: args.instanceId,
      commands: {DesktopCommand.refresh: busy ? null : _load},
      appBar: AppBar(title: Text(title)),
      body: Stack(
        children: [
          if (loading)
            const Center(child: CircularProgressIndicator(color: Vc.green))
          else
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (error != null) ...[
                  Text(error!, style: const TextStyle(color: Vc.red)),
                  const SizedBox(height: 16),
                ],
                if (instance != null || _autopayForSize) ...[
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'AUTOPAY',
                          style: TextStyle(
                            color: Vc.green,
                            fontSize: 11,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          instance?.billingSummary ?? 'Monthly autopay is not on for this workspace.',
                          style: TextStyle(
                            color: instance != null && (instance!.paymentFailed || instance!.billingSuspended)
                                ? Vc.red
                                : null,
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Start autopay, change size or cancel on the web dashboard. '
                          'Card or UPI Autopay / e-mandate required; charges are not refunded, '
                          'and cancelling keeps access until the paid period ends.',
                          style: TextStyle(color: Vc.muted, height: 1.4, fontSize: 12),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: busy ? null : _openWebBilling,
                          icon: const Icon(Icons.open_in_new, size: 18),
                          label: const Text('Manage billing on the web'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                ],
                VcPanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'VECTRA CLOUD',
                        style: TextStyle(
                          color: Vc.green,
                          fontSize: 11,
                          letterSpacing: 1.4,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        plan.label ?? 'Workspace plan',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${plan.inrLabel} or ${plan.usdLabel} · ${plan.periodDays ?? 30} days',
                        style: const TextStyle(color: Vc.muted, height: 1.4),
                      ),
                      if (args.name != null) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Workspace: ${args.name}',
                          style: const TextStyle(color: Vc.muted),
                        ),
                      ],
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: busy ? null : () => _pay('INR'),
                        child: SizedBox(
                          width: double.infinity,
                          child: Text(
                            'Pay ${plan.inrLabel}',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: busy ? null : () => _pay('USD'),
                        child: SizedBox(
                          width: double.infinity,
                          child: Text(
                            'Pay ${plan.usdLabel}',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  'Secure checkout opens inside the app. After payment is verified by the server, the workspace is created or renewed automatically.',
                  style: const TextStyle(color: Vc.muted, height: 1.4),
                ),
              ],
            ),
          if (busy) const BusyOverlay(message: 'Processing payment…'),
        ],
      ),
    );
  }
}
