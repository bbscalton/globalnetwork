import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../services/place.dart';
import '../theme.dart';

class PendingApprovalScreen extends StatelessWidget {
  const PendingApprovalScreen({super.key, required this.account, required this.onSignOut});

  final CustomerAccount account;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Application sent'),
        actions: [TextButton(onPressed: onSignOut, child: const Text('Sign out'))],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.hourglass_top, size: 56, color: GnTheme.cyan),
            const SizedBox(height: 16),
            Text(
              account.name.trim().isEmpty ? 'Waiting for approval' : 'Thanks, ${account.name.trim()}',
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const Text(
              'Your ID and billing-address photos are on the GlobalNetwork owner desk. Chat, line reports, and internet days stay locked until they approve you.',
              style: TextStyle(height: 1.45, fontSize: 16),
            ),
            const SizedBox(height: 16),
            Text(
              [
                if (account.phone.isNotEmpty) account.phone,
                if (account.locationLabel.isNotEmpty) account.locationLabel
                else if (account.address.isNotEmpty && !looksLikeCoordinates(account.address)) account.address,
                if (account.email.isNotEmpty) account.email,
              ].join('\n'),
              style: const TextStyle(color: Colors.white70, height: 1.4),
            ),
            const SizedBox(height: 20),
            const Text(
              'After approval they will assign your package and days from the payment they receive, or from their own assessment.',
              style: TextStyle(height: 1.45),
            ),
          ],
        ),
      ),
    );
  }
}
