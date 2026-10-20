import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

/// Current app build number (from pubspec.yaml version+NN)
const int currentBuildNumber = 15;

/// Platform identifier for version check
String get currentPlatform {
  if (kIsWeb) return 'web';
  if (Platform.isAndroid) return 'android';
  if (Platform.isIOS) return 'ios';
  return 'unknown';
}

class VersionCheckResult {
  final bool updateRequired;
  final bool updateAvailable;
  final String message;
  final String downloadUrl;
  final int minVersion;
  final int latestVersion;

  VersionCheckResult({
    required this.updateRequired,
    required this.updateAvailable,
    required this.message,
    required this.downloadUrl,
    required this.minVersion,
    required this.latestVersion,
  });

  factory VersionCheckResult.none() => VersionCheckResult(
    updateRequired: false,
    updateAvailable: false,
    message: '',
    downloadUrl: '',
    minVersion: 0,
    latestVersion: 0,
  );
}

class VersionCheckService {
  final _functions = FirebaseFunctions.instance;

  Future<VersionCheckResult> check() async {
    if (kIsWeb) return VersionCheckResult.none();
    
    try {
      final callable = _functions.httpsCallableFromUrl(
        'https://us-central1-globalnetwork-isp.cloudfunctions.net/checkAppVersion',
      );
      final res = await callable.call<Map<String, dynamic>>({
        'version': currentBuildNumber,
        'platform': currentPlatform,
      });
      final data = res.data;
      return VersionCheckResult(
        updateRequired: data['updateRequired'] == true,
        updateAvailable: data['updateAvailable'] == true,
        message: data['updateMessage'] as String? ?? '',
        downloadUrl: data['downloadUrl'] as String? ?? '',
        minVersion: (data['minVersion'] as num?)?.toInt() ?? 0,
        latestVersion: (data['latestVersion'] as num?)?.toInt() ?? 0,
      );
    } catch (e) {
      // Silent failure - don't block app if version check fails
      return VersionCheckResult.none();
    }
  }

  Future<bool> openDownloadUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
