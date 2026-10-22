import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../theme.dart';

/// "My usage": this customer's own data use this month (customers/{id}/usage/current).
/// Firestore rules only allow the signed-in owner of this customer record (or desk staff) to read it.
class MyUsageCard extends StatelessWidget {
  const MyUsageCard({super.key, required this.customerId});

  final String customerId;

  static String currentMonth() {
    // Router / billing zone: America/Guyana (UTC-4, no DST).
    final t = DateTime.now().toUtc().subtract(const Duration(hours: 4));
    return '${t.year}-${t.month.toString().padLeft(2, '0')}';
  }

  static String fmtBytes(num v) {
    if (v < 1024) return '${v.toInt()} B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    double x = v / 1024;
    int i = 0;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    return '${x.toStringAsFixed(x >= 100 ? 0 : (x >= 10 ? 1 : 2))} ${units[i]}';
  }

  @override
  Widget build(BuildContext context) {
    final db = FirebaseFirestore.instance;
    final usageRef = db.collection('customers').doc(customerId).collection('usage').doc('current');
    final custRef = db.collection('customers').doc(customerId);
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: usageRef.snapshots(),
      builder: (context, usageSnap) {
        final u = usageSnap.data?.data();
        if (u == null) return const SizedBox.shrink();
        final months = (u['months'] is Map) ? Map<String, dynamic>.from(u['months'] as Map) : <String, dynamic>{};
        final b = (months[currentMonth()] is Map) ? Map<String, dynamic>.from(months[currentMonth()] as Map) : <String, dynamic>{};
        final down = (b['downBytes'] as num?) ?? 0;
        final up = (b['upBytes'] as num?) ?? 0;
        final total = down + up;
        return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: custRef.snapshots(),
          builder: (context, custSnap) {
            final c = custSnap.data?.data() ?? const <String, dynamic>{};
            final limitGb = (c['dataLimitGb'] as num?) ?? 0;
            final limitBytes = limitGb > 0 ? limitGb * 1024 * 1024 * 1024 : 0;
            final pct = limitBytes > 0 ? (total / limitBytes).clamp(0.0, 1.0).toDouble() : 0.0;
            final speed = c['er7206Speed'];
            final throttled = speed is Map && speed['throttled'] == true;
            return Container(
              margin: const EdgeInsets.only(top: 16),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: GnTheme.cyan.withValues(alpha: 0.35)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('My usage this month', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 8),
                  Text(
                    limitBytes > 0 ? '${fmtBytes(total)} of ${limitGb.toString()} GB' : fmtBytes(total),
                    style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: GnTheme.cyan),
                  ),
                  if (limitBytes > 0) ...[
                    const SizedBox(height: 8),
                    LinearProgressIndicator(value: pct, minHeight: 8, borderRadius: BorderRadius.circular(8)),
                  ],
                  const SizedBox(height: 8),
                  Text('Download ${fmtBytes(down)} · Upload ${fmtBytes(up)}', style: const TextStyle(color: Colors.white70)),
                  if (throttled) ...[
                    const SizedBox(height: 6),
                    const Text('Your speed is currently reduced. Contact the desk to restore full speed.',
                        style: TextStyle(color: Color(0xFFFBBF24), fontWeight: FontWeight.w600)),
                  ],
                ],
              ),
            );
          },
        );
      },
    );
  }
}
