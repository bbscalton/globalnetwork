import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Set to true after running `flutterfire configure` in this folder.
const kFirebaseOptionsReady = false;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Web is not used for the customer app.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
      case TargetPlatform.iOS:
        throw UnsupportedError(
          'Run `flutterfire configure` in customer-app/ then set kFirebaseOptionsReady = true.',
        );
      default:
        throw UnsupportedError('Unsupported platform.');
    }
  }
}
