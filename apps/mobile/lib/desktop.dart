import 'dart:io';

/// Linux/Windows/macOS desktop builds of the same Flutter app.
bool get isDesktop =>
    Platform.isLinux || Platform.isWindows || Platform.isMacOS;

bool get isMobileApp => Platform.isAndroid || Platform.isIOS;
