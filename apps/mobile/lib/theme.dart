import 'package:flutter/material.dart';

class Vc {
  static const bg = Color(0xFF050505);
  static const card = Color(0xFF0C0C0E);
  static const cardBorder = Color(0xFF27272A);
  static const muted = Color(0xFFA1A1AA);
  static const faint = Color(0xFF71717A);
  static const green = Color(0xFF22C55E);
  static const greenDim = Color(0xFF166534);
  static const amber = Color(0xFFFBBF24);
  static const red = Color(0xFFF87171);
  static const blue = Color(0xFF60A5FA);

  static ThemeData dark() {
    final base = ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: green,
        brightness: Brightness.dark,
        surface: bg,
      ),
    );
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      appBarTheme: const AppBarTheme(
        backgroundColor: bg,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: cardBorder),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF18181B),
        labelStyle: const TextStyle(color: muted),
        hintStyle: const TextStyle(color: faint),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: green),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: green,
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      dividerColor: cardBorder,
    );
  }

  static Color stateColor(String state) {
    switch (state.toLowerCase()) {
      case 'running':
        return green;
      case 'paused':
        return amber;
      case 'error':
      case 'destroyed':
      case 'missing':
        return red;
      default:
        return muted;
    }
  }
}
