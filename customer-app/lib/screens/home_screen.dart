import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.account, required this.onChat, required this.onIssue, required this.onSignOut});

  final CustomerAccount account;
  final VoidCallback onChat;
  final VoidCallback onIssue;
  final VoidCallback onSignOut;

  Color get _statusColor {
    switch (account.status) {
      case 'active':
        return const Color(0xFF34D399);
      case 'grace':
        return const Color(0xFFFBBF24);
      default:
        return const Color(0xFFF87171);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = account.daysLeft().clamp(0, 9999);
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset('assets/logo-gn.png', width: 32, height: 32, errorBuilder: (_, __, ___) => const Icon(Icons.public)),
            const SizedBox(width: 10),
            const Text('GlobalNetwork'),
          ],
        ),
        actions: [IconButton(onPressed: onSignOut, icon: const Icon(Icons.logout))],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF0B1F4A), Color(0xFF164E63)]),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: GnTheme.cyan.withValues(alpha: 0.4)),
              boxShadow: [BoxShadow(color: GnTheme.cyan.withValues(alpha: 0.18), blurRadius: 24, offset: const Offset(0, 10))],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(account.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                Text(account.planName.isEmpty ? 'No package yet' : account.planName),
                const SizedBox(height: 12),
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: days.toDouble()),
                  duration: const Duration(milliseconds: 900),
                  builder: (context, value, _) => Text(
                    '${value.round()}',
                    style: const TextStyle(fontSize: 56, fontWeight: FontWeight.w800, color: GnTheme.cyan),
                  ),
                ),
                const Text('days remaining'),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: _statusColor.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    account.status.toUpperCase(),
                    style: TextStyle(color: _statusColor, fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                ),
                const SizedBox(height: 8),
                Text('Balance due EC\$${account.balanceDue.toStringAsFixed(0)}'),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'If you cannot pay the full fee, ask the owner to extend a certain number of days. They will record the partial payment from the owner desk.',
          ),
          const SizedBox(height: 20),
          FilledButton.icon(onPressed: onChat, icon: const Icon(Icons.chat_bubble), label: const Text('Chat with GlobalNetwork')),
          const SizedBox(height: 10),
          OutlinedButton.icon(onPressed: onIssue, icon: const Icon(Icons.report_problem), label: const Text('Report an issue with photo')),
        ],
      ),
    );
  }
}
