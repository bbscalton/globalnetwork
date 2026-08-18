import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;

import '../models/customer.dart';

class GnApi {
  GnApi({required this.r2BaseUrl});

  final String r2BaseUrl;
  final _auth = FirebaseAuth.instance;
  final _db = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(region: 'us-central1');
  GoogleSignIn? _google;

  GoogleSignIn get _googleClient {
    return _google ??= GoogleSignIn(
      scopes: const ['email', 'profile'],
      serverClientId: '367351875740-matj6sj8li188ool3fi0lra6h58ne2ht.apps.googleusercontent.com',
    );
  }

  User? get user => _auth.currentUser;

  Stream<User?> authChanges() => _auth.authStateChanges();

  Future<void> signIn(String email, String password) {
    return _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> register(String email, String password) async {
    await _auth.createUserWithEmailAndPassword(email: email, password: password);
  }

  Future<void> signInWithGoogle() async {
    if (kIsWeb) {
      final provider = GoogleAuthProvider()
        ..addScope('email')
        ..addScope('profile')
        ..setCustomParameters({'prompt': 'select_account'});
      // Popup only: redirect on GitHub Pages drops the session (same as ops-web).
      await _auth.signInWithPopup(provider);
      return;
    }
    final account = await _googleClient.signIn();
    if (account == null) {
      throw Exception('Google sign-in was cancelled.');
    }
    final tokens = await account.authentication;
    final idToken = tokens.idToken;
    if (idToken == null || idToken.isEmpty) {
      await _googleClient.signOut();
      throw Exception('Google did not return an ID token. Try again.');
    }
    await _auth.signInWithCredential(
      GoogleAuthProvider.credential(idToken: idToken, accessToken: tokens.accessToken),
    );
  }

  Future<void> signOut() async {
    if (!kIsWeb) {
      try {
        await _googleClient.signOut();
      } catch (_) {}
    }
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

  Stream<List<PaymentRecord>> watchPayments(String customerId) {
    return _db
        .collection('customers')
        .doc(customerId)
        .collection('payments')
        .orderBy('atMs', descending: true)
        .snapshots()
        .map(
          (s) => s.docs.map((d) => PaymentRecord.from(d.id, d.data())).toList(),
        );
  }

  Stream<List<ChatLine>> watchChat(String customerId) {
    return _db
        .collection('customers')
        .doc(customerId)
        .collection('chatMessages')
        .orderBy('createdAtMs')
        .snapshots()
        .map(
          (s) => s.docs.map((d) => ChatLine.from(d.id, d.data())).toList(),
        );
  }

  Future<void> sendChat(String customerId, String text) {
    return sendChatMessage(customerId: customerId, text: text, kind: 'text');
  }

  Future<void> sendChatMessage({
    required String customerId,
    required String text,
    required String kind,
    String? mediaUrl,
    int durationMs = 0,
    double? lat,
    double? lng,
  }) {
    return _db.collection('customers').doc(customerId).collection('chatMessages').add({
      'from': 'customer',
      'text': text,
      'kind': kind,
      if (mediaUrl != null && mediaUrl.isNotEmpty) 'mediaUrl': mediaUrl,
      if (durationMs > 0) 'durationMs': durationMs,
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<String> uploadChatFile({
    required String customerId,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final safe = fileName.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
    final key = 'orgs/globalnetwork/customers/$customerId/chat/$stamp-$safe';
    return _putR2(key: key, bytes: bytes, contentType: contentType);
  }

  Future<String?> readFcmToken() async {
    if (kIsWeb) return null;
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
    final token = await user?.getIdToken(true);
    final sign = await http.post(
      Uri.parse('$r2BaseUrl/sign-upload'),
      headers: {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      },
      body: jsonEncode({'key': key, 'contentType': contentType}),
    );
    if (sign.statusCode >= 300) {
      throw Exception('Could not prepare the upload (${sign.statusCode}).');
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
    if (put.statusCode >= 300) throw Exception('Could not upload the file (${put.statusCode}).');
    return '$r2BaseUrl/object?key=${Uri.encodeComponent(key)}';
  }

  Future<void> submitApplication({
    required String customerId,
    required String name,
    required String phone,
    required String address,
    required String idPhotoUrl,
    required String billingPhotoUrl,
    double? lat,
    double? lng,
    String? locationLabel,
  }) async {
    await _functions.httpsCallable('submitCustomerApplication').call(<String, dynamic>{
      'customerId': customerId,
      'name': name,
      'phone': phone,
      'address': address,
      'idPhotoUrl': idPhotoUrl,
      'billingPhotoUrl': billingPhotoUrl,
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
      if (locationLabel != null && locationLabel.isNotEmpty) 'locationLabel': locationLabel,
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

  Future<List<Map<String, dynamic>>> fetchIceServers() async {
    final fallback = [
      {
        'urls': ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'],
      },
    ];
    try {
      final token = await user?.getIdToken();
      final res = await http.get(
        Uri.parse('$r2BaseUrl/ice-servers'),
        headers: {if (token != null) 'authorization': 'Bearer $token'},
      );
      if (res.statusCode >= 300) return fallback;
      final payload = jsonDecode(res.body) as Map<String, dynamic>;
      final servers = payload['iceServers'];
      if (servers is List && servers.isNotEmpty) {
        return servers.map((row) => Map<String, dynamic>.from(row as Map)).toList();
      }
    } catch (_) {}
    return fallback;
  }

  CollectionReference<Map<String, dynamic>> _calls(String customerId) {
    return _db.collection('customers').doc(customerId).collection('calls');
  }

  Future<String> startVoiceCall({required String customerId, required String offerSdp}) async {
    final ref = await _calls(customerId).add({
      'from': 'customer',
      'status': 'ringing',
      'offerSdp': offerSdp,
      'offerFrom': 'customer',
      'negotiationGen': 1,
      'videoActive': false,
      'ownerVideoVisible': false,
      'startedAtMs': DateTime.now().millisecondsSinceEpoch,
    });
    return ref.id;
  }

  Future<void> pushCallOffer({
    required String customerId,
    required String callId,
    required String offerSdp,
    required int negotiationGen,
    required bool videoActive,
  }) {
    return _calls(customerId).doc(callId).update({
      'offerSdp': offerSdp,
      'negotiationGen': negotiationGen,
      'offerFrom': 'customer',
      'videoActive': videoActive,
    });
  }

  Future<void> pushCallAnswer({
    required String customerId,
    required String callId,
    required String answerSdp,
    required int negotiationGen,
  }) {
    return _calls(customerId).doc(callId).update({
      'answerSdp': answerSdp,
      'negotiationGen': negotiationGen,
    });
  }

  Stream<Map<String, dynamic>?> watchCall(String customerId, String callId) {
    return _calls(customerId).doc(callId).snapshots().map((snap) {
      if (!snap.exists || snap.data() == null) return null;
      return snap.data();
    });
  }

  Future<void> addIceAnswer({
    required String customerId,
    required String callId,
    required String candidate,
    String? sdpMid,
    int? sdpMLineIndex,
  }) {
    return _calls(customerId).doc(callId).collection('iceAnswer').add({
      'candidate': candidate,
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
      if (sdpMid != null && sdpMid.isNotEmpty) 'sdpMid': sdpMid,
      if (sdpMLineIndex != null) 'sdpMLineIndex': sdpMLineIndex,
    });
  }

  Stream<Map<String, dynamic>> watchIceAnswer(String customerId, String callId) {
    return _calls(customerId).doc(callId).collection('iceAnswer').snapshots().expand((snap) {
      return snap.docChanges
          .where((change) => change.type == DocumentChangeType.added)
          .map((change) => change.doc.data() ?? <String, dynamic>{});
    });
  }

  Future<void> addIceOffer({
    required String customerId,
    required String callId,
    required String candidate,
    String? sdpMid,
    int? sdpMLineIndex,
  }) {
    return _calls(customerId).doc(callId).collection('iceOffer').add({
      'candidate': candidate,
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
      if (sdpMid != null && sdpMid.isNotEmpty) 'sdpMid': sdpMid,
      if (sdpMLineIndex != null) 'sdpMLineIndex': sdpMLineIndex,
    });
  }

  Future<void> hangupCall({
    required String customerId,
    required String callId,
    required String status,
  }) async {
    await _calls(customerId).doc(callId).update({
      'status': status,
      'endedAtMs': DateTime.now().millisecondsSinceEpoch,
      'endedBy': 'customer',
    });
  }
}
