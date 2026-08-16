import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key, this.instanceId});
  final String? instanceId;

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  Map<String, dynamic>? cfg;
  String? error;
  bool loading = true;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      cfg = await context.read<SessionController>().client.billingConfig();
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _pay(String currency) async {
    setState(() => busy = true);
    try {
      final api = context.read<SessionController>().client;
      await api.createOrder(
        purpose: widget.instanceId == null ? 'new_instance' : 'renew',
        instanceId: widget.instanceId,
        currency: currency,
      );
      await launchUrl(Uri.parse('${api.baseUrl}/dashboard'), mode: LaunchMode.externalApplication);
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final plan = cfg?['plan'] as Map<String, dynamic>?;
    return Scaffold(
      appBar: AppBar(title: const Text('Billing')),
      body: Stack(
        children: [
          if (loading)
            const Center(child: CircularProgressIndicator(color: Vc.green))
          else
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (error != null) Text(error!, style: const TextStyle(color: Vc.red)),
                if (plan != null) ...[
                  Text('${plan['label'] ?? 'Plan'}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Text(
                    '₹${plan['priceInr']} or \$${plan['priceUsd']} / ${plan['periodDays']} days',
                    style: const TextStyle(color: Vc.muted),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(onPressed: busy ? null : () => _pay('INR'), child: const Text('Pay in INR')),
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: busy ? null : () => _pay('USD'), child: const Text('Pay in USD')),
                  const SizedBox(height: 16),
                  const Text(
                    'Checkout finishes on the dashboard (Razorpay). Return here after payment.',
                    style: TextStyle(color: Vc.muted),
                  ),
                ],
              ],
            ),
          if (busy) const BusyOverlay(message: 'Opening checkout…'),
        ],
      ),
    );
  }
}
