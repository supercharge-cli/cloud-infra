import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme.dart';
import '../desktop.dart';

class BusyOverlay extends StatelessWidget {
  const BusyOverlay({super.key, required this.message, this.detail});
  final String message;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black.withValues(alpha: 0.72),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 280),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Vc.card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Vc.cardBorder),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 36,
                    height: 36,
                    child: CircularProgressIndicator(
                      color: Vc.green,
                      strokeWidth: 3,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                      letterSpacing: -0.2,
                    ),
                  ),
                  if (detail != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      detail!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Vc.muted,
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class StateChip extends StatelessWidget {
  const StateChip(this.state, {super.key});
  final String state;

  @override
  Widget build(BuildContext context) {
    final c = Vc.stateColor(state);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: c.withValues(alpha: 0.4)),
      ),
      child: Text(
        state,
        style: TextStyle(color: c, fontSize: 11, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class StatusDot extends StatelessWidget {
  const StatusDot(this.state, {super.key, this.size = 9});
  final String state;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = Vc.stateColor(state);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: c,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: c.withValues(alpha: 0.55),
            blurRadius: 8,
            spreadRadius: 0.5,
          ),
        ],
      ),
    );
  }
}

class TypingDots extends StatefulWidget {
  const TypingDots({super.key, this.label = 'Working'});
  final String label;
  @override
  State<TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.maybeOf(context)?.disableAnimations ?? false) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final n = (_c.value * 3).floor() + 1;
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              widget.label,
              style: const TextStyle(color: Vc.muted, fontSize: 13),
            ),
            Text(
              '.' * n,
              style: const TextStyle(
                color: Vc.green,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        );
      },
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.subtitle});
  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 15,
              letterSpacing: -0.2,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 3),
            Text(
              subtitle!,
              style: const TextStyle(
                color: Vc.faint,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class VcPanel extends StatelessWidget {
  const VcPanel({super.key, required this.child, this.padding});
  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: Material(
        color: Vc.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(isDesktop ? 8 : 18),
          side: const BorderSide(color: Vc.cardBorder),
        ),
        child: Padding(
          padding: padding ?? const EdgeInsets.all(16),
          child: child,
        ),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({
    super.key,
    required this.message,
    this.onRetry,
    this.onDismiss,
  });
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF450A0A),
      child: ListTile(
        dense: true,
        title: Text(
          message,
          style: const TextStyle(color: Vc.red, fontSize: 13),
        ),
        trailing: onRetry != null
            ? TextButton(onPressed: onRetry, child: const Text('Retry'))
            : (onDismiss != null
                  ? IconButton(
                      onPressed: onDismiss,
                      icon: const Icon(Icons.close, size: 18, color: Vc.red),
                    )
                  : null),
        onTap: onDismiss,
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.detail,
  });
  final IconData icon;
  final String title;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 48, 28, 24),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Vc.elevated,
              shape: BoxShape.circle,
              border: Border.all(color: Vc.cardBorder),
            ),
            child: Icon(icon, size: 28, color: Vc.green),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 17,
              letterSpacing: -0.2,
            ),
          ),
          if (detail != null) ...[
            const SizedBox(height: 8),
            Text(
              detail!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Vc.muted, height: 1.45),
            ),
          ],
        ],
      ),
    );
  }
}

class ReconnectBar extends StatelessWidget {
  const ReconnectBar({super.key, this.message = 'Reconnecting…'});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF1C1917),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          const SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2, color: Vc.amber),
          ),
          const SizedBox(width: 10),
          Text(message, style: const TextStyle(color: Vc.amber, fontSize: 12)),
        ],
      ),
    );
  }
}

class ControlButton extends StatelessWidget {
  const ControlButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
    this.enabled = true,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Colors.white;
    return Expanded(
      child: Opacity(
        opacity: enabled ? 1 : 0.4,
        child: Material(
          color: Vc.elevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(color: c.withValues(alpha: 0.28)),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: enabled ? onTap : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                children: [
                  Icon(icon, size: 20, color: c),
                  const SizedBox(height: 4),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      color: c,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SecretField extends StatefulWidget {
  const SecretField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.helper,
  });
  final TextEditingController controller;
  final String label;
  final String? hint;
  final String? helper;

  @override
  State<SecretField> createState() => _SecretFieldState();
}

class _SecretFieldState extends State<SecretField> {
  bool hide = true;

  @override
  Widget build(BuildContext context) {
    final set = widget.controller.text.trim().isNotEmpty;
    return TextField(
      controller: widget.controller,
      obscureText: hide,
      enableSuggestions: false,
      autocorrect: false,
      onChanged: (_) => setState(() {}),
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        helperText:
            widget.helper ??
            (set ? 'Loaded from sandbox — tap the eye to reveal' : 'Not set'),
        helperMaxLines: 2,
        suffixIcon: SizedBox(
          width: set ? 96 : 48,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (set)
                IconButton(
                  tooltip: 'Copy',
                  onPressed: () {
                    Clipboard.setData(
                      ClipboardData(text: widget.controller.text),
                    );
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(const SnackBar(content: Text('Copied')));
                  },
                  icon: const Icon(Icons.copy, size: 18, color: Vc.muted),
                ),
              IconButton(
                tooltip: hide ? 'Show' : 'Hide',
                onPressed: () => setState(() => hide = !hide),
                icon: Icon(
                  hide
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                  size: 20,
                  color: Vc.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AppPopScope extends StatelessWidget {
  const AppPopScope({
    super.key,
    required this.child,
    this.isRoot = false,
    this.onBack,
  });
  final Widget child;
  final bool isRoot;
  final bool Function()? onBack;

  static Future<bool> confirmLeave(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Leave Vectra?'),
        content: const Text(
          'The app will close. Running sandbox tasks keep going in a live notification.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Stay'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Close app'),
          ),
        ],
      ),
    );
    return ok == true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (onBack?.call() == true) return;
        if (context.canPop()) {
          context.pop();
          return;
        }
        if (isRoot) {
          final leave = await confirmLeave(context);
          if (leave && context.mounted) SystemNavigator.pop();
          return;
        }
        context.go('/');
      },
      child: child,
    );
  }
}
