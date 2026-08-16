import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/session.dart';

class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key, this.instanceId});
  final String? instanceId;

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  Map<String, dynamic>? cfg;
  String? error;
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
    if (mounted) setState(() {});
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
      // Checkout lives on the website until native Razorpay keys are wired.
      final base = api.baseUrl;
      await launchUrl(
        Uri.parse('$base/dashboard'),
        mode: LaunchMode.externalApplication,
      );
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
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (error != null) Text(error!, style: const TextStyle(color: Colors.redAccent)),
          if (plan != null) ...[
            Text('${plan['label'] ?? plan['name'] ?? 'Plan'}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('₹${plan['priceInr']} or \$${plan['priceUsd']} / ${plan['periodDays']} days'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : () => _pay('INR'),
              child: const Text('Pay in INR'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: busy ? null : () => _pay('USD'),
              child: const Text('Pay in USD'),
            ),
            const SizedBox(height: 16),
            const Text('Checkout completes on the dashboard (Razorpay). Come back here after payment.'),
          ] else
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
        ],
      ),
    );
  }
}
