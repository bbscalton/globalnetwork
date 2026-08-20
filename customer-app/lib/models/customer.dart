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
    this.lat,
    this.lng,
    this.locationLabel = '',
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
  final double? lat;
  final double? lng;
  final String locationLabel;

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
        return 'Internet is on (day extension)';
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
        return balanceDue > 0
            ? 'You are on a day extension. ${ec(balanceDue)} is still due (plan and/or extensions).'
            : 'You are on a day extension. Chat with GlobalNetwork if you need to renew.';
      case 'suspended':
        return 'GlobalNetwork paused this account. Chat to get it turned back on.';
      default:
        if (feeAmount > 0) {
          return 'Pay the full package fee of ${ec(feeAmount)} to renew. Partial plan payments are not accepted.';
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

  static String when(int atMs) {
    if (atMs <= 0) return 'Date not recorded';
    final d = DateTime.fromMillisecondsSinceEpoch(atMs);
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final ampm = d.hour >= 12 ? 'PM' : 'AM';
    final min = d.minute.toString().padLeft(2, '0');
    return '${d.day} ${months[d.month - 1]} ${d.year}, $hour12:$min $ampm';
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
      lat: (data['lat'] as num?)?.toDouble(),
      lng: (data['lng'] as num?)?.toDouble(),
      locationLabel: (data['locationLabel'] ?? '') as String,
    );
  }
}

class PaymentRecord {
  PaymentRecord({
    required this.id,
    required this.amount,
    required this.kind,
    required this.daysGranted,
    required this.note,
    required this.atMs,
    this.balanceAdded = 0,
  });

  final String id;
  final double amount;
  final String kind;
  final int daysGranted;
  final String note;
  final int atMs;
  final double balanceAdded;

  String get kindLabel {
    switch (kind) {
      case 'partial':
        return 'Partial (legacy)';
      case 'grace':
        return 'Grace';
      case 'adjust':
        return 'Time adjust';
      case 'extension':
        if (amount > 0) return 'Extension paid';
        return 'Extension charged';
      default:
        return 'Plan due';
    }
  }

  String get dateLabel => CustomerAccount.when(atMs);

  String get amountLabel => CustomerAccount.ec(amount);

  String get daysLabel {
    if (kind == 'extension') {
      if (amount > 0) {
        return '$daysGranted days · ${CustomerAccount.ec(amount)} collected';
      }
      return '$daysGranted days · ${CustomerAccount.ec(balanceAdded)} charged to extension';
    }
    if (daysGranted == 0) return 'No days added';
    if (daysGranted == 1) return '1 day granted';
    if (daysGranted == -1) return '1 day removed';
    if (daysGranted < 0) return '${daysGranted.abs()} days removed';
    return '$daysGranted days granted';
  }

  factory PaymentRecord.from(String id, Map<String, dynamic> data) {
    final rawKind = (data['kind'] as String?)?.trim() ?? 'full';
    const known = {'partial', 'grace', 'adjust', 'extension'};
    final kind = known.contains(rawKind) ? rawKind : 'full';
    return PaymentRecord(
      id: id,
      amount: (data['amount'] as num?)?.toDouble() ?? 0,
      kind: kind,
      daysGranted: (data['daysGranted'] as num?)?.toInt() ?? 0,
      note: (data['note'] as String?)?.trim() ?? '',
      atMs: (data['atMs'] as num?)?.toInt() ?? 0,
      balanceAdded: (data['balanceAdded'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ChatLine {
  ChatLine({
    required this.id,
    required this.from,
    required this.text,
    required this.kind,
    required this.createdAtMs,
    this.mediaUrl,
    this.durationMs = 0,
    this.lat,
    this.lng,
  });

  final String id;
  final String from;
  final String text;
  final String kind;
  final String? mediaUrl;
  final int durationMs;
  final int createdAtMs;
  final double? lat;
  final double? lng;

  bool get mine => from == 'customer';
  bool get isVoice => kind == 'voice' || (kind == 'call' && mediaUrl != null && mediaUrl!.isNotEmpty);
  bool get isVideo => kind == 'video';
  bool get isLocation => kind == 'location' && lat != null && lng != null;
  bool get isCall => kind == 'call';

  factory ChatLine.from(String id, Map<String, dynamic> data) {
    final mediaUrl = (data['mediaUrl'] as String?)?.trim();
    final rawKind = (data['kind'] as String?)?.trim() ?? '';
    var kind = rawKind.isEmpty ? 'text' : rawKind;
    if (kind == 'text' && mediaUrl != null && mediaUrl.isNotEmpty) {
      final lower = mediaUrl.toLowerCase();
      if (lower.contains('/calls/') || lower.contains('.webm')) {
        kind = 'call';
      } else if (lower.contains('.mp4') || lower.contains('video')) {
        kind = 'video';
      } else if (lower.contains('.m4a') || lower.contains('audio') || lower.contains('voice')) {
        kind = 'voice';
      }
    }
    return ChatLine(
      id: id,
      from: (data['from'] ?? 'owner') as String,
      text: (data['text'] ?? '') as String,
      kind: kind,
      mediaUrl: (mediaUrl == null || mediaUrl.isEmpty) ? null : mediaUrl,
      durationMs: (data['durationMs'] as num?)?.toInt() ?? 0,
      createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
      lat: (data['lat'] as num?)?.toDouble(),
      lng: (data['lng'] as num?)?.toDouble(),
    );
  }
}

class IssueTicket {
  IssueTicket({required this.id, required this.title, required this.status, required this.createdAtMs});
  final String id;
  final String title;
  final String status;
  final int createdAtMs;
}
