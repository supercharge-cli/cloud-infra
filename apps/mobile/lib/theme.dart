import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class Vc {
  static const bg = Color(0xFF07080A);
  static const surface = Color(0xFF101114);
  static const card = Color(0xFF14161A);
  static const elevated = Color(0xFF1A1D23);
  static const cardBorder = Color(0xFF2A2E36);
  static const muted = Color(0xFFA1A1AA);
  static const faint = Color(0xFF71717A);
  static const green = Color(0xFF22C55E);
  static const greenSoft = Color(0xFF4ADE80);
  static const greenDim = Color(0xFF14532D);
  static const amber = Color(0xFFFBBF24);
  static const red = Color(0xFFF87171);
  static const blue = Color(0xFF60A5FA);

  static const overlay = SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    statusBarBrightness: Brightness.dark,
    systemNavigationBarColor: bg,
    systemNavigationBarIconBrightness: Brightness.light,
  );

  static ThemeData dark() {
    final base = ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      colorScheme: const ColorScheme.dark(
        primary: green,
        onPrimary: Colors.black,
        secondary: greenSoft,
        surface: bg,
        onSurface: Colors.white,
        error: red,
      ),
    );
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: const AppBarTheme(
        backgroundColor: bg,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
        systemOverlayStyle: overlay,
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: cardBorder),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: elevated,
        contentTextStyle: const TextStyle(color: Colors.white),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: elevated,
        selectedColor: green.withValues(alpha: 0.18),
        labelStyle: const TextStyle(color: Colors.white, fontSize: 12),
        side: const BorderSide(color: cardBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: elevated,
        labelStyle: const TextStyle(color: muted),
        hintStyle: const TextStyle(color: faint),
        helperStyle: const TextStyle(color: faint, fontSize: 12),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: green, width: 1.4),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: green,
          foregroundColor: Colors.black,
          disabledBackgroundColor: const Color(0xFF14532D),
          disabledForegroundColor: const Color(0xFF86EFAC),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: cardBorder),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: greenSoft),
      ),
      dividerColor: cardBorder,
      dividerTheme: const DividerThemeData(color: cardBorder, space: 1),
    );
  }

  static Color stateColor(String state) {
    switch (state.toLowerCase()) {
      case 'running':
        return green;
      case 'paused':
        return amber;
      case 'past_due':
      case 'error':
      case 'destroyed':
      case 'missing':
        return red;
      default:
        return muted;
    }
  }
}
