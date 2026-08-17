import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;

import '../models/customer.dart';

class GnApi {
  GnApi({required this.r2BaseUrl});

  final String r2BaseUrl;
  final _auth = FirebaseAuth.instance;
  final _db = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(region: 'us-central1');
  final _google = GoogleSignIn(
    scopes: const ['email', 'profile'],
    serverClientId: '367351875740-matj6sj8li188ool3fi0lra6h58ne2ht.apps.googleusercontent.com',
  );

  User? get user => _auth.currentUser;

  Stream<User?> authChanges() => _auth.authStateChanges();

  Future<void> signIn(String email, String password) {
    return _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> register(String email, String password) async {
    await _auth.createUserWithEmailAndPassword(email: email, password: password);
  }

  Future<void> signInWithGoogle() async {
    final account = await _google.signIn();
    if (account == null) {
      throw Exception('Google sign-in was cancelled.');
    }
    final tokens = await account.authentication;
    final idToken = tokens.idToken;
    if (idToken == null || idToken.isEmpty) {
      await _google.signOut();
      throw Exception('Google did not return an ID token. Try again.');
    }
    await _auth.signInWithCredential(
      GoogleAuthProvider.credential(idToken: idToken, accessToken: tokens.accessToken),
    );
  }

  Future<void> signOut() async {
    try {
      await _google.signOut();
    } catch (_) {}
    await _auth.signOut();
  }

  Future<String> linkAccount() async {
    final user = _auth.currentUser;
    if (user != null) {
      await user.reload();
      await user.getIdToken(true);
    }
    final callable = _functions.httpsCallable('linkCustomerAccount');
    final res = await callable.call(<String, dynamic>{});
    final data = Map<String, dynamic>.from(res.data as Map);
    final id = data['customerId'] as String?;
    if (id == null || id.isEmpty) {
      throw Exception('No customer record for this email.');
    }
    return id;
  }

  Stream<CustomerAccount?> watchCustomer(String customerId) {
    return _db.collection('customers').doc(customerId).snapshots().map((snap) {
      if (!snap.exists || snap.data() == null) return null;
      return CustomerAccount.from(snap.id, snap.data()!);
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
                  from: (d.data()['from'] ?? 'owner') as String,
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

  Future<String?> readFcmToken() async {
    try {
      await FirebaseMessaging.instance.requestPermission();
      return FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  Future<void> heartbeat(String customerId) async {
    final token = await readFcmToken();
    await _functions.httpsCallable('heartbeat').call(<String, dynamic>{
      'customerId': customerId,
      if (token != null) 'fcmToken': token,
    });
  }

  Future<String> uploadIssuePhoto({
    required String customerId,
    required String issueId,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) {
    final key = 'orgs/globalnetwork/customers/$customerId/issues/$issueId/$fileName';
    return _putR2(key: key, bytes: bytes, contentType: contentType);
  }

  Future<String> uploadKycPhoto({
    required String customerId,
    required String kind,
    required Uint8List bytes,
  }) {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final key = 'orgs/globalnetwork/customers/$customerId/kyc/$kind-$stamp.jpg';
    return _putR2(key: key, bytes: bytes, contentType: 'image/jpeg');
  }

  Future<String> _putR2({
    required String key,
    required Uint8List bytes,
    required String contentType,
  }) async {
    const token = await user?.getIdToken(true);
    final sign = await http.post(
      Uri.parse('$r2BaseUrl/sign-upload'),
      headers: {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      },
      body: jsonEncode({'key': key, 'contentType': contentType}),
    );
    if (sign.statusCode >= 300) {
      throw Exception('Could not prepare the photo upload (${sign.statusCode}).');
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
    if (put.statusCode >= 300) throw Exception('Could not upload the photo (${put.statusCode}).');
    return '$r2BaseUrl/object?key=${Uri.encodeComponent(key)}';
  }

  Future<void> submitApplication({
    required String customerId,
    required String name,
    required String phone,
    required String address,
    required String idPhotoUrl,
    required String billingPhotoUrl,
  }) async {
    await _functions.httpsCallable('submitCustomerApplication').call(<String, dynamic>{
      'customerId': customerId,
      'name': name,
      'phone': phone,
      'address': address,
      'idPhotoUrl': idPhotoUrl,
      'billingPhotoUrl': billingPhotoUrl,
    });
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
