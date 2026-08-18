import 'package:flutter/material.dart';

import '../models/customer.dart';
import '../services/api.dart';
import '../theme.dart';

class PaymentHistoryScreen extends StatelessWidget {
  const PaymentHistoryScreen({super.key, required this.api, required this.customerId});

  final GnApi api;
  final String customerId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payment history')),
      body: StreamBuilder<List<PaymentRecord>>(
        stream: api.watchPayments(customerId),
        builder: (context, snap) {
          if (snap.hasError) {
            return const _EmptyPane(
              icon: Icons.error_outline,
              text: 'Could not load payments. Check your internet and try again.',
            );
          }
          if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final rows = snap.data ?? const <PaymentRecord>[];
          if (rows.isEmpty) {
            return const _EmptyPane(
              icon: Icons.receipt_long_outlined,
              text: 'No payments yet. GlobalNetwork will show them here after the desk records a collection.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) => _PaymentCard(row: rows[i]),
          );
        },
      ),
    );
  }
}

class _EmptyPane extends StatelessWidget {
  const _EmptyPane({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 48, 28, 24),
      child: Column(
        children: [
          Icon(icon, size: 52, color: GnTheme.cyan),
          const SizedBox(height: 16),
          Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70, height: 1.45, fontSize: 16),
          ),
        ],
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.row});

  final PaymentRecord row;

  Color get _tone {
    switch (row.kind) {
      case 'partial':
        return const Color(0xFFFBBF24);
      case 'grace':
        return const Color(0xFF38BDF8);
      case 'adjust':
        return const Color(0xFFA78BFA);
      default:
        return const Color(0xFF34D399);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: GnTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _tone.withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  row.dateLabel,
                  style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: _tone.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  row.kindLabel,
                  style: TextStyle(color: _tone, fontWeight: FontWeight.w800, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            row.amountLabel,
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: GnTheme.cyan, height: 1),
          ),
          const SizedBox(height: 8),
          Text(row.daysLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
          if (row.note.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(row.note, style: const TextStyle(color: Colors.white70, height: 1.4)),
          ],
        ],
      ),
    );
  }
}
