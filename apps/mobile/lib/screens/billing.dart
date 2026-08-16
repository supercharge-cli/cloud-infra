import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
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
  late final Razorpay _rzp;

  BillingArgs get args => widget.args ?? const BillingArgs();

  @override
  void initState() {
    super.initState();
    _rzp = Razorpay();
    _rzp.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onSuccess);
    _rzp.on(Razorpay.EVENT_PAYMENT_ERROR, _onError);
    _load();
  }

  @override
  void dispose() {
    _rzp.clear();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      cfg = await context.read<SessionController>().client.billingConfig();
      plan = PlanInfo.fromJson(cfg?['plan'] as Map<String, dynamic>?);
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _pay(String currency) async {
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
      );
      _rzp.open({
        'key': order['keyId'],
        'amount': order['amount'],
        'currency': order['currency'] ?? currency,
        'name': 'Vectra Cloud',
        'description': args.renew ? 'Renew ${args.instanceId}' : 'New instance ${args.name ?? ''}',
        'order_id': order['orderId'],
        'prefill': {'email': session.user?.email ?? ''},
        'theme': {'color': '#22C55E'},
      });
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => busy = false);
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
    final title = args.renew ? 'Renew instance' : (args.name == null ? 'Billing' : 'Pay & create');
    return AppPopScope(
      child: Scaffold(
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
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('VECTRA CLOUD', style: TextStyle(color: Vc.green, fontSize: 11, letterSpacing: 1.4, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        Text(plan.label ?? 'Workspace plan', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                        const SizedBox(height: 8),
                        Text(
                          '${plan.inrLabel} or ${plan.usdLabel} · ${plan.periodDays ?? 30} days',
                          style: const TextStyle(color: Vc.muted, height: 1.4),
                        ),
                        if (args.name != null) ...[
                          const SizedBox(height: 10),
                          Text('Instance: ${args.name}', style: const TextStyle(color: Vc.muted)),
                        ],
                        const SizedBox(height: 18),
                        FilledButton(
                          onPressed: busy ? null : () => _pay('INR'),
                          child: SizedBox(width: double.infinity, child: Text(plan.inrButton, textAlign: TextAlign.center)),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: busy ? null : () => _pay('USD'),
                          child: SizedBox(width: double.infinity, child: Text(plan.usdButton, textAlign: TextAlign.center)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Checkout opens Razorpay on this device. After payment the instance is created or renewed automatically.',
                    style: TextStyle(color: Vc.muted, height: 1.4),
                  ),
                ],
              ),
            if (busy) const BusyOverlay(message: 'Processing payment…'),
          ],
        ),
      ),
    );
  }
}
