import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

const kFirebaseOptionsReady = true;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Unsupported platform.');
    }
  }

  /// Firebase web app for project `globalnetwork-d544c`.
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBYcQTdZ7Yre-CNoePe42jSdt7R4gjw6M0',
    appId: '1:694576693138:web:2e8c2d5b53c76b4eff4b4b',
    messagingSenderId: '694576693138',
    projectId: 'globalnetwork-d544c',
    authDomain: 'globalnetwork-d544c.firebaseapp.com',
    storageBucket: 'globalnetwork-d544c.firebasestorage.app',
    measurementId: 'G-H7TQG08Y2J',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBpMY4JIb9lh8tXMVINgVOb_QUjvjZnzrE',
    appId: '1:694576693138:android:185818bc70879802ff4b4b',
    messagingSenderId: '694576693138',
    projectId: 'globalnetwork-d544c',
    storageBucket: 'globalnetwork-d544c.firebasestorage.app',
  );

  /// iOS uses the web app config until a dedicated iOS app is registered.
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBYcQTdZ7Yre-CNoePe42jSdt7R4gjw6M0',
    appId: '1:694576693138:web:2e8c2d5b53c76b4eff4b4b',
    messagingSenderId: '694576693138',
    projectId: 'globalnetwork-d544c',
    authDomain: 'globalnetwork-d544c.firebaseapp.com',
    storageBucket: 'globalnetwork-d544c.firebasestorage.app',
    measurementId: 'G-H7TQG08Y2J',
  );
}
