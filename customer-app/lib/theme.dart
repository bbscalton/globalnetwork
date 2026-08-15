import 'package:flutter/material.dart';

class GnTheme {
  static const navy = Color(0xFF050816);
  static const cyan = Color(0xFF22D3EE);
  static const card = Color(0xFF0B1F4A);

  static ThemeData dark() {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: navy,
      colorScheme: const ColorScheme.dark(
        primary: cyan,
        surface: card,
      ),
      useMaterial3: true,
    );
  }
}
