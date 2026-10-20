import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/customer.dart';
import '../services/api.dart';
import '../theme.dart';

class ExtendServiceScreen extends StatefulWidget {
  const ExtendServiceScreen({
    super.key,
    required this.api,
    required this.account,
  });

  final GnApi api;
  final CustomerAccount account;

  @override
  State<ExtendServiceScreen> createState() => _ExtendServiceScreenState();
}

class _ExtendServiceScreenState extends State<ExtendServiceScreen> {
  int _days = 1;
  int _ratePerDay = 6;
  int _minDays = 1;
  int _maxDays = 90;
  bool _loading = true;
  bool _submitting = false;
  String? _error;
  bool _confirmed = false;

  @override
  void initState() {
    super.initState();
    _loadRate();
  }

  Future<void> _loadRate() async {
    try {
      final rate = await widget.api.getExtensionRate();
      if (!mounted) return;
      setState(() {
        _ratePerDay = (rate['ratePerDay'] as num?)?.toInt() ?? 6;
        _minDays = (rate['minDays'] as num?)?.toInt() ?? 1;
        _maxDays = (rate['maxDays'] as num?)?.toInt() ?? 90;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load extension rate. Please try again.';
      });
    }
  }

  int get _total => _days * _ratePerDay;

  Future<void> _submit() async {
    if (!_confirmed) {
      setState(() => _error = 'Please confirm the extension details first.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final result = await widget.api.requestDayExtension(
        customerId: widget.account.id,
        days: _days,
      );

      if (!mounted) return;

      final message = result['message'] as String? ?? 'Extension request sent!';
      final serverTotal = (result['totalXcd'] as num?)?.toInt() ?? _total;

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          backgroundColor: GnTheme.card,
          title: const Row(
            children: [
              Icon(Icons.check_circle, color: Color(0xFF34D399), size: 28),
              SizedBox(width: 12),
              Text('Request Sent'),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(message),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: GnTheme.navy.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Summary',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Days requested'),
                        Text(
                          '$_days day${_days == 1 ? '' : 's'}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Total'),
                        Text(
                          'EC\$$serverTotal',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            color: GnTheme.cyan,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                Navigator.of(context).pop(true);
              },
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message ?? e.code;
        _submitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final daysLeft = widget.account.daysLeft();
    final isExpired = widget.account.status == 'expired' || daysLeft <= 0;
    final isNearExpiry = daysLeft > 0 && daysLeft <= 3;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Extend Service'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (isExpired)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF87171).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: const Color(0xFFF87171).withValues(alpha: 0.3),
                      ),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.warning_amber, color: Color(0xFFF87171)),
                        SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Your service has expired. Request an extension to get back online.',
                            style: TextStyle(color: Color(0xFFFCA5A5)),
                          ),
                        ),
                      ],
                    ),
                  )
                else if (isNearExpiry)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFBBF24).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: const Color(0xFFFBBF24).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.schedule, color: Color(0xFFFBBF24)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Your service expires in $daysLeft day${daysLeft == 1 ? '' : 's'}. Extend now to avoid interruption.',
                            style: const TextStyle(color: Color(0xFFFDE68A)),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 24),
                const Text(
                  'How many days do you need?',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Text(
                  'EC\$$_ratePerDay per day · Charged to your balance or collected by GlobalNetwork',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: GnTheme.card,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: GnTheme.cyan.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          IconButton.filled(
                            onPressed: _days > _minDays
                                ? () {
                                    HapticFeedback.lightImpact();
                                    setState(() {
                                      _days--;
                                      _confirmed = false;
                                    });
                                  }
                                : null,
                            icon: const Icon(Icons.remove),
                            style: IconButton.styleFrom(
                              backgroundColor: GnTheme.navy,
                              foregroundColor: GnTheme.cyan,
                            ),
                          ),
                          const SizedBox(width: 24),
                          Column(
                            children: [
                              Text(
                                '$_days',
                                style: const TextStyle(
                                  fontSize: 48,
                                  fontWeight: FontWeight.w800,
                                  color: GnTheme.cyan,
                                ),
                              ),
                              Text(
                                _days == 1 ? 'day' : 'days',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.7),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(width: 24),
                          IconButton.filled(
                            onPressed: _days < _maxDays
                                ? () {
                                    HapticFeedback.lightImpact();
                                    setState(() {
                                      _days++;
                                      _confirmed = false;
                                    });
                                  }
                                : null,
                            icon: const Icon(Icons.add),
                            style: IconButton.styleFrom(
                              backgroundColor: GnTheme.navy,
                              foregroundColor: GnTheme.cyan,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Slider(
                        value: _days.toDouble(),
                        min: _minDays.toDouble(),
                        max: _maxDays.toDouble(),
                        divisions: _maxDays - _minDays,
                        activeColor: GnTheme.cyan,
                        inactiveColor: GnTheme.navy,
                        onChanged: (value) {
                          HapticFeedback.selectionClick();
                          setState(() {
                            _days = value.round();
                            _confirmed = false;
                          });
                        },
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '$_minDays day',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withValues(alpha: 0.5),
                            ),
                          ),
                          Text(
                            '$_maxDays days',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withValues(alpha: 0.5),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0B1F4A), Color(0xFF164E63)],
                    ),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: GnTheme.cyan.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '$_days day${_days == 1 ? '' : 's'} × EC\$$_ratePerDay',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.8),
                            ),
                          ),
                          Text(
                            'EC\$$_total',
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              color: GnTheme.cyan,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      CheckboxListTile(
                        value: _confirmed,
                        onChanged: (value) {
                          setState(() => _confirmed = value ?? false);
                        },
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                        activeColor: GnTheme.cyan,
                        checkColor: GnTheme.navy,
                        title: Text(
                          'I confirm $_days day${_days == 1 ? '' : 's'} extension for EC\$$_total',
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF87171).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: Color(0xFFF87171), size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _error!,
                            style: const TextStyle(color: Color(0xFFFCA5A5)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _submitting || !_confirmed ? null : _submit,
                  icon: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: GnTheme.navy,
                          ),
                        )
                      : const Icon(Icons.send),
                  style: FilledButton.styleFrom(
                    backgroundColor: GnTheme.cyan,
                    foregroundColor: GnTheme.navy,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    disabledBackgroundColor: GnTheme.cyan.withValues(alpha: 0.3),
                  ),
                  label: Text(_submitting ? 'Sending request…' : 'Request Extension'),
                ),
                const SizedBox(height: 16),
                Text(
                  'GlobalNetwork will contact you about payment. The extension will be activated once payment is received.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
    );
  }
}
