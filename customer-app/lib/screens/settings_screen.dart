import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../theme.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.account,
    required this.onPaymentHistory,
    required this.onSignOut,
  });

  final CustomerAccount account;
  final VoidCallback onPaymentHistory;
  final VoidCallback onSignOut;

  String get _village {
    if (account.locationLabel.trim().isNotEmpty && !RegExp(r'^-?\d+\.\d+').hasMatch(account.locationLabel)) {
      return account.locationLabel.trim();
    }
    if (RegExp(r'^-?\d{1,2}\.\d+\s*[ ,]\s*-?\d{1,3}\.\d+$').hasMatch(account.address.trim())) {
      return account.locationLabel.trim().isEmpty ? 'Location pin saved' : account.locationLabel.trim();
    }
    return account.address.trim();
  }

  @override
  Widget build(BuildContext context) {
    final days = account.daysLeft().clamp(0, 9999);
    final plan = account.planName.trim().isEmpty
        ? 'No package assigned yet'
        : '${account.planName}${account.planDays > 0 ? ' · ${account.planDays} days' : ''}${account.feeAmount > 0 ? ' · ${CustomerAccount.ec(account.feeAmount)}' : ''}';

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text('Your account', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          _row('Name', account.name.trim().isEmpty ? 'Not set' : account.name.trim()),
          _row('Phone', account.phone.trim().isEmpty ? 'Not set' : account.phone.trim()),
          _row('Email', account.email.trim().isEmpty ? 'Not set' : account.email.trim()),
          _row('Village / address', _village.isEmpty ? 'Not set' : _village),
          _row('Days left', '$days'),
          _row('Plan', plan),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.receipt_long_outlined, color: GnTheme.cyan),
            title: const Text('Payment history', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: const Text('What you paid, in EC dollars', style: TextStyle(color: Colors.white70)),
            trailing: const Icon(Icons.chevron_right),
            onTap: onPaymentHistory,
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: onSignOut,
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
            child: const Text('Sign out'),
          ),
          const SizedBox(height: 28),
          const Text('About', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text(
            'GlobalNetwork Antigua. Internet packages are billed in EC dollars (XCD).',
            style: TextStyle(color: Colors.white70, height: 1.45, fontSize: 15),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: GnTheme.cyan, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.35)),
        ],
      ),
    );
  }
}
