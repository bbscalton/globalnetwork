import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

const kFirebaseOptionsReady = true;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Web is not used for the customer app.');
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

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBkv6V-EDJZWHoRFyVDbl5dRVvwMwqlZTI',
    appId: '1:367351875740:web:471e1f400fe8e805c64559',
    messagingSenderId: '367351875740',
    projectId: 'globalnetwork-isp',
    authDomain: 'globalnetwork-isp.firebaseapp.com',
    storageBucket: 'globalnetwork-isp.appspot.com',
  );

  static const FirebaseOptions ios = android;
}
