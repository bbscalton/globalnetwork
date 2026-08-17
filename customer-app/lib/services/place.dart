import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

class SitePin {
  const SitePin({required this.lat, required this.lng, required this.label});
  final double lat;
  final double lng;
  final String label;
}

final coordPattern = RegExp(r'^\s*(-?\d{1,2}\.\d{3,})\s*[ ,]\s*(-?\d{1,3}\.\d{3,})\s*$');

bool looksLikeCoordinates(String value) => coordPattern.hasMatch(value.trim());

({double lat, double lng})? parseCoordinates(String value) {
  final match = coordPattern.firstMatch(value.trim());
  if (match == null) return null;
  final lat = double.tryParse(match.group(1)!);
  final lng = double.tryParse(match.group(2)!);
  if (lat == null || lng == null) return null;
  if (lat.abs() > 90 || lng.abs() > 180) return null;
  return (lat: lat, lng: lng);
}

String villageFromNominatim(Map<String, dynamic> json) {
  final address = json['address'];
  if (address is Map) {
    final village = address['village'] ??
        address['hamlet'] ??
        address['suburb'] ??
        address['neighbourhood'] ??
        address['town'] ??
        address['city'] ??
        address['municipality'];
    final area = address['county'] ?? address['state_district'] ?? address['state'];
    if (village is String && village.trim().isNotEmpty) {
      if (area is String && area.trim().isNotEmpty && !village.toLowerCase().contains(area.toLowerCase())) {
        return '${village.trim()}, ${area.trim()}';
      }
      return village.trim();
    }
  }
  final display = (json['display_name'] as String? ?? '').split(',');
  final parts = display.map((p) => p.trim()).where((p) => p.isNotEmpty && !looksLikeCoordinates(p)).take(2);
  final label = parts.join(', ');
  return label.isEmpty ? 'Shared pin in Antigua' : label;
}

Future<String> reverseGeocode(double lat, double lng) async {
  final uri = Uri.https('nominatim.openstreetmap.org', '/reverse', {
    'lat': lat.toStringAsFixed(6),
    'lon': lng.toStringAsFixed(6),
    'format': 'jsonv2',
    'zoom': '16',
    'addressdetails': '1',
  });
  final res = await http.get(uri, headers: {'User-Agent': 'GlobalNetworkAntigua/1.0 (customer-app)', 'Accept': 'application/json'});
  if (res.statusCode >= 300) return 'Shared pin in Antigua';
  final json = jsonDecode(res.body);
  if (json is Map<String, dynamic>) return villageFromNominatim(json);
  return 'Shared pin in Antigua';
}

Future<SitePin> captureSitePin() async {
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
    throw Exception('Allow location so GlobalNetwork can send a technician to the right village.');
  }
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw Exception('Turn on Location on this phone, then try again.');
  }
  final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
  final label = await reverseGeocode(pos.latitude, pos.longitude);
  return SitePin(lat: pos.latitude, lng: pos.longitude, label: label);
}
