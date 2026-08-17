class CustomerAccount {
  CustomerAccount({
    required this.id,
    required this.name,
    required this.email,
    required this.phone,
    required this.address,
    required this.status,
    required this.planName,
    required this.planDays,
    required this.paidUntilMs,
    required this.balanceDue,
    required this.feeAmount,
    required this.approvalStatus,
    required this.rejectionReason,
    required this.idPhotoUrl,
    required this.billingPhotoUrl,
  });

  final String id;
  final String name;
  final String email;
  final String phone;
  final String address;
  final String status;
  final String planName;
  final int planDays;
  final int? paidUntilMs;
  final double balanceDue;
  final double feeAmount;
  final String approvalStatus;
  final String rejectionReason;
  final String idPhotoUrl;
  final String billingPhotoUrl;

  bool get needsRegistration => approvalStatus == 'none' || approvalStatus == 'rejected';
  bool get isPendingApproval => approvalStatus == 'pending';
  bool get canUseApp => approvalStatus == 'approved' || approvalStatus.isEmpty;

  int daysLeft() {
    final until = paidUntilMs;
    if (until == null) return 0;
    return ((until - DateTime.now().millisecondsSinceEpoch) / 86400000).ceil();
  }

  bool get internetOn => status == 'active' || status == 'grace';

  String get serviceHeadline {
    switch (status) {
      case 'active':
        return 'Internet is on';
      case 'grace':
        return 'Internet is on (partial payment)';
      case 'suspended':
        return 'Account paused';
      default:
        return 'Internet is off';
    }
  }

  String get serviceDetail {
    final days = daysLeft();
    switch (status) {
      case 'active':
        if (days <= 0) return 'Your package ends today. Chat with GlobalNetwork to renew.';
        if (days == 1) return '1 day left on your package.';
        return '$days days left on your package.';
      case 'grace':
        return 'You are on the line with a partial payment. ${ec(balanceDue)} is still due.';
      case 'suspended':
        return 'GlobalNetwork paused this account. Chat to get it turned back on.';
      default:
        if (feeAmount > 0) {
          return 'Pay ${ec(feeAmount)} or ask GlobalNetwork to add days if you cannot pay the full fee.';
        }
        return 'Your record is open. GlobalNetwork will add your package and days from the owner desk.';
    }
  }

  String get validUntilLabel {
    final until = paidUntilMs;
    if (until == null || until <= 0) return 'No service date yet';
    final d = DateTime.fromMillisecondsSinceEpoch(until);
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return 'Valid until ${d.day} ${months[d.month - 1]} ${d.year}';
  }

  static String ec(double amount) {
    final n = amount.round().abs().toString();
    final buf = StringBuffer();
    for (var i = 0; i < n.length; i++) {
      final fromEnd = n.length - i;
      if (i > 0 && fromEnd % 3 == 0) buf.write(',');
      buf.write(n[i]);
    }
    return 'EC\$$buf';
  }

  factory CustomerAccount.from(String id, Map<String, dynamic> data) {
    return CustomerAccount(
      id: id,
      name: (data['name'] ?? '') as String,
      email: (data['email'] ?? '') as String,
      phone: (data['phone'] ?? '') as String,
      address: (data['address'] ?? '') as String,
      status: (data['status'] ?? 'expired') as String,
      planName: (data['planName'] ?? '') as String,
      planDays: (data['planDays'] as num?)?.toInt() ?? 0,
      paidUntilMs: data['paidUntilMs'] == null ? null : (data['paidUntilMs'] as num).toInt(),
      balanceDue: (data['balanceDue'] as num?)?.toDouble() ?? 0,
      feeAmount: (data['feeAmount'] as num?)?.toDouble() ?? 0,
      approvalStatus: (data['approvalStatus'] ?? '') as String,
      rejectionReason: (data['rejectionReason'] ?? '') as String,
      idPhotoUrl: (data['idPhotoUrl'] ?? '') as String,
      billingPhotoUrl: (data['billingPhotoUrl'] ?? '') as String,
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

class IssueTicket {
  IssueTicket({required this.id, required this.title, required this.status, required this.createdAtMs});
  final String id;
  final String title;
  final String status;
  final int createdAtMs;
}
