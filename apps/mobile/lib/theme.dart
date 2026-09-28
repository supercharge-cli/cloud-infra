import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class Vc {
  static const bg = Color(0xFF0B141A);
  static const surface = Color(0xFF111B21);
  static const card = Color(0xFF1C2A32);
  static const elevated = Color(0xFF202F38);
  static const cardBorder = Color(0xFF314149);
  static const muted = Color(0xFFAFBEC7);
  static const faint = Color(0xFF93A6B2);
  static const green = Color(0xFF35C5A3);
  static const greenSoft = Color(0xFF6EE5C4);
  static const greenDim = Color(0xFF164D40);
  static const sentBubble = Color(0xFF145249);
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

  static ThemeData dark({bool desktop = false}) {
    final base = ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      fontFamily: desktop ? 'Adwaita Sans' : null,
      fontFamilyFallback: desktop
          ? const ['Cantarell', 'Noto Sans', 'DejaVu Sans']
          : null,
      visualDensity: desktop ? VisualDensity.compact : VisualDensity.standard,
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
      splashFactory: desktop
          ? NoSplash.splashFactory
          : InkSparkle.splashFactory,
      hoverColor: Colors.white.withValues(alpha: .06),
      focusColor: green.withValues(alpha: .16),
      scrollbarTheme: ScrollbarThemeData(
        thickness: const WidgetStatePropertyAll(8),
        radius: const Radius.circular(4),
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.hovered)
              ? muted
              : faint.withValues(alpha: .6),
        ),
      ),
      tooltipTheme: const TooltipThemeData(
        waitDuration: Duration(milliseconds: 400),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: greenSoft,
        selectionColor: green.withValues(alpha: .28),
        selectionHandleColor: green,
      ),
      appBarTheme: AppBarTheme(
        toolbarHeight: desktop ? 54 : null,
        backgroundColor: desktop ? surface : bg,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: desktop ? 'Adwaita Sans' : 'Roboto',
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
          borderRadius: BorderRadius.circular(desktop ? 8 : 18),
          side: const BorderSide(color: cardBorder),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(desktop ? 10 : 20),
        ),
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
        labelStyle: TextStyle(fontFamily: desktop ? 'Adwaita Sans' : 'Roboto', color: Colors.white, fontSize: 12),
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
        contentPadding: EdgeInsets.symmetric(
          horizontal: 12,
          vertical: desktop ? 11 : 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(desktop ? 6 : 14),
          borderSide: const BorderSide(color: cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(desktop ? 6 : 14),
          borderSide: const BorderSide(color: cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(desktop ? 6 : 14),
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
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(desktop ? 6 : 14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: cardBorder),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(desktop ? 6 : 14),
          ),
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
      case 'cli update':
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
