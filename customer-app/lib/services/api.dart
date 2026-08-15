import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

import '../models/customer.dart';

class GnApi {
  GnApi({required this.r2BaseUrl});

  final String r2BaseUrl;
  final _auth = FirebaseAuth.instance;
  final _db = FirebaseFirestore.instance;

  User? get user => _auth.currentUser;

  Future<void> signIn(String email, String password) {
    return _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> register(String email, String password) async {
    await _auth.createUserWithEmailAndPassword(email: email, password: password);
  }

  Future<void> signOut() => _auth.signOut();

  Stream<CustomerAccount?> watchCustomer() {
    final email = user?.email?.toLowerCase();
    if (email == null) return Stream.value(null);
    return _db
        .collection('customers')
        .where('email', isEqualTo: email)
        .limit(1)
        .snapshots()
        .map((snap) {
      if (snap.docs.isEmpty) return null;
      return CustomerAccount.from(snap.docs.first.id, snap.docs.first.data());
    });
  }

  Stream<List<ChatLine>> watchChat(String customerId) {
    return _db
        .collection('customers')
        .doc(customerId)
        .collection('chatMessages')
        .orderBy('createdAtMs')
        .snapshots()
        .map(
          (s) => s.docs
              .map(
                (d) => ChatLine(
                  id: d.id,
                  from: (d.data()['from'] ?? 'staff') as String,
                  text: (d.data()['text'] ?? '') as String,
                  createdAtMs: (d.data()['createdAtMs'] as num?)?.toInt() ?? 0,
                ),
              )
              .toList(),
        );
  }

  Future<void> sendChat(String customerId, String text) {
    return _db.collection('customers').doc(customerId).collection('chatMessages').add({
      'from': 'customer',
      'text': text,
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<void> heartbeat(String customerId) {
    return _db.collection('customers').doc(customerId).set(
      {'lastSeenMs': DateTime.now().millisecondsSinceEpoch, 'uid': user?.uid},
      SetOptions(merge: true),
    );
  }

  Future<String> uploadIssuePhoto({
    required String customerId,
    required String issueId,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final token = await user?.getIdToken();
    final key = 'orgs/globalnetwork/customers/$customerId/issues/$issueId/$fileName';
    final sign = await http.post(
      Uri.parse('$r2BaseUrl/sign-upload'),
      headers: {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      },
      body: jsonEncode({'key': key, 'contentType': contentType}),
    );
    if (sign.statusCode >= 300) {
      throw Exception('sign-upload failed ${sign.statusCode}');
    }
    final payload = jsonDecode(sign.body) as Map<String, dynamic>;
    final putUrl = payload['putUrl'] as String;
    final put = await http.put(
      Uri.parse(putUrl),
      headers: {
        'content-type': contentType,
        if (token != null) 'authorization': 'Bearer $token',
      },
      body: bytes,
    );
    if (put.statusCode >= 300) throw Exception('R2 PUT failed ${put.statusCode}');
    return '$r2BaseUrl/object?key=${Uri.encodeComponent(key)}';
  }

  Future<void> createIssue({
    required String customerId,
    required String title,
    required String body,
    required List<String> photoUrls,
  }) {
    return _db.collection('customers').doc(customerId).collection('issues').add({
      'title': title,
      'body': body,
      'status': 'open',
      'photoUrls': photoUrls,
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
    });
  }
}
