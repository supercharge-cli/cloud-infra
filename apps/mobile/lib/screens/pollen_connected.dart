import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme.dart';

/// Full-screen check after Pollinations BYOP returns from the website.
class PollenConnectedScreen extends StatefulWidget {
  const PollenConnectedScreen({super.key, required this.instanceId});
  final String instanceId;

  @override
  State<PollenConnectedScreen> createState() => _PollenConnectedScreenState();
}

class _PollenConnectedScreenState extends State<PollenConnectedScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  late final Animation<double> _pop;
  late final Animation<double> _check;
  late final Animation<double> _fade;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));
    _pop = CurvedAnimation(parent: _c, curve: const Interval(0, 0.45, curve: Curves.elasticOut));
    _check = CurvedAnimation(parent: _c, curve: const Interval(0.28, 0.62, curve: Curves.easeOutBack));
    _fade = CurvedAnimation(parent: _c, curve: const Interval(0.4, 0.75, curve: Curves.easeOut));
    _c.forward();
    Future<void>.delayed(const Duration(milliseconds: 2400), _go);
  }

  void _go() {
    if (!mounted) return;
    final id = widget.instanceId;
    if (id.isEmpty) {
      context.go('/');
      return;
    }
    context.go('/instance/$id');
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Vc.bg,
      body: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          return SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Transform.scale(
                      scale: _pop.value.clamp(0.0, 1.2),
                      child: Container(
                        width: 112,
                        height: 112,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Vc.green,
                          boxShadow: [
                            BoxShadow(
                              color: Vc.green.withValues(alpha: 0.35 * _pop.value.clamp(0.0, 1.0)),
                              blurRadius: 36,
                              spreadRadius: 4,
                            ),
                          ],
                        ),
                        child: Opacity(
                          opacity: _check.value.clamp(0.0, 1.0),
                          child: Transform.rotate(
                            angle: (1 - _check.value.clamp(0.0, 1.0)) * -math.pi / 8,
                            child: const Icon(Icons.check_rounded, size: 68, color: Colors.black),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                    Opacity(
                      opacity: _fade.value.clamp(0.0, 1.0),
                      child: Column(
                        children: [
                          Text(
                            'PAYMENT CONFIRMED',
                            style: TextStyle(
                              color: Vc.greenSoft,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.8,
                            ),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'Pollen connected',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 28,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.6,
                            ),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'This workspace now spends your Pollinations balance. Opening settings…',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Vc.muted, height: 1.45, fontSize: 15),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
