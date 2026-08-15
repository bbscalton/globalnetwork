class CustomerAccount {
  CustomerAccount({
    required this.id,
    required this.name,
    required this.status,
    required this.planName,
    required this.paidUntilMs,
    required this.balanceDue,
    required this.feeAmount,
  });

  final String id;
  final String name;
  final String status;
  final String planName;
  final int? paidUntilMs;
  final double balanceDue;
  final double feeAmount;

  int daysLeft() {
    final until = paidUntilMs;
    if (until == null) return 0;
    return ((until - DateTime.now().millisecondsSinceEpoch) / 86400000).ceil();
  }

  factory CustomerAccount.from(String id, Map<String, dynamic> data) {
    return CustomerAccount(
      id: id,
      name: (data['name'] ?? '') as String,
      status: (data['status'] ?? 'expired') as String,
      planName: (data['planName'] ?? '') as String,
      paidUntilMs: data['paidUntilMs'] == null ? null : (data['paidUntilMs'] as num).toInt(),
      balanceDue: (data['balanceDue'] as num?)?.toDouble() ?? 0,
      feeAmount: (data['feeAmount'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ChatLine {
  ChatLine({required this.id, required this.from, required this.text, required this.createdAtMs});
  final String id;
  final String from;
  final String text;
  final int createdAtMs;
}
