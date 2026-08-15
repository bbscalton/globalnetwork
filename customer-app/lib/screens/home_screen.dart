import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.account, required this.onChat, required this.onIssue, required this.onSignOut});

  final CustomerAccount account;
  final VoidCallback onChat;
  final VoidCallback onIssue;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final days = account.daysLeft();
    return Scaffold(
      appBar: AppBar(
        title: const Text('GlobalNetwork'),
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
              border: Border.all(color: GnTheme.cyan.withOpacity(0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(account.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                Text(account.planName),
                const SizedBox(height: 12),
                Text('$days', style: const TextStyle(fontSize: 56, fontWeight: FontWeight.w800, color: GnTheme.cyan)),
                const Text('days remaining'),
                const SizedBox(height: 8),
                Text('Status: ${account.status} · balance G\$${account.balanceDue.toStringAsFixed(0)}'),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'If you cannot pay the full fee, ask the provider to extend a certain number of days. Staff will record the partial payment from the web console.',
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
