import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.account,
    required this.onChat,
    required this.onCall,
    required this.onVideoCall,
    required this.onIssue,
    required this.onSignOut,
  });

  final CustomerAccount account;
  final VoidCallback onChat;
  final VoidCallback onCall;
  final VoidCallback onVideoCall;
  final VoidCallback onIssue;
  final VoidCallback onSignOut;

  Color get _tone {
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
    final village = account.locationLabel.trim().isNotEmpty && !RegExp(r'^-?\d+\.\d+').hasMatch(account.locationLabel)
        ? account.locationLabel.trim()
        : (RegExp(r'^-?\d{1,2}\.\d+\s*[ ,]\s*-?\d{1,3}\.\d+$').hasMatch(account.address.trim())
            ? (account.locationLabel.trim().isEmpty ? 'Location pin saved' : account.locationLabel.trim())
            : account.address.trim());
    final contact = [
      if (village.isNotEmpty) village,
      if (account.phone.trim().isNotEmpty) account.phone.trim(),
      if (account.email.trim().isNotEmpty) account.email.trim(),
    ].join(' · ');

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset('assets/logo-gn.png', width: 32, height: 32, errorBuilder: (_, __, ___) => const Icon(Icons.public)),
            const SizedBox(width: 10),
            const Text('My account'),
          ],
        ),
        actions: [
          TextButton(onPressed: onSignOut, child: const Text('Sign out')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Text(
            account.name.trim().isEmpty ? 'Hello' : 'Hello, ${account.name.trim()}',
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            contact.isEmpty ? 'GlobalNetwork · Antigua · billed in EC dollars' : contact,
            style: const TextStyle(color: Colors.white70, height: 1.4),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF0B1F4A), Color(0xFF164E63)]),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: _tone.withValues(alpha: 0.45)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: _tone.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    account.serviceHeadline,
                    style: TextStyle(color: _tone, fontWeight: FontWeight.w800),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '$days',
                  style: const TextStyle(fontSize: 64, fontWeight: FontWeight.w800, color: GnTheme.cyan, height: 0.95),
                ),
                const Text('days of internet remaining', style: TextStyle(fontSize: 16)),
                const SizedBox(height: 8),
                Text(account.validUntilLabel, style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 16),
                Text(
                  account.planName.trim().isEmpty
                      ? 'No package assigned yet'
                      : '${account.planName}${account.planDays > 0 ? ' · ${account.planDays} days' : ''}${account.feeAmount > 0 ? ' · ${CustomerAccount.ec(account.feeAmount)}' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                ),
                const SizedBox(height: 6),
                Text(
                  account.balanceDue > 0
                      ? 'Amount due ${CustomerAccount.ec(account.balanceDue)}'
                      : 'Nothing owed right now',
                  style: TextStyle(
                    color: account.balanceDue > 0 ? const Color(0xFFFBBF24) : Colors.white70,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(account.serviceDetail, style: const TextStyle(height: 1.45, fontSize: 15)),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onChat,
            icon: const Icon(Icons.chat_bubble),
            style: FilledButton.styleFrom(
              backgroundColor: GnTheme.cyan,
              foregroundColor: GnTheme.navy,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            label: const Text('Chat with GlobalNetwork'),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: onCall,
            icon: const Icon(Icons.phone_in_talk),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF0EA5E9),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            label: const Text('Call the desk'),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: onVideoCall,
            icon: const Icon(Icons.videocam),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF0369A1),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            label: const Text('Video call'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: onIssue,
            icon: const Icon(Icons.report_problem_outlined),
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
            label: const Text('Report a line problem'),
          ),
        ],
      ),
    );
  }
}
