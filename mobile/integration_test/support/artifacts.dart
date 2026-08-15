import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Writes a PNG of the current frame when a test fails.
///
/// On the Android emulator the file lands in the app documents directory.
/// The CI wrapper also captures `adb screencap` / logcat as a fallback.
Future<void> saveFailureScreenshot(WidgetTester tester, String name) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byType(RepaintBoundary).first,
  );
  final image = await boundary.toImage(pixelRatio: 1.5);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  if (bytes == null) {
    return;
  }

  Directory dir;
  try {
    dir = Directory('/sdcard/Documents/publira-integration');
    dir.createSync(recursive: true);
  } on FileSystemException {
    dir = Directory('${Directory.systemTemp.path}/publira-integration');
    dir.createSync(recursive: true);
  }

  final file = File('${dir.path}/$name.png');
  await file.writeAsBytes(bytes.buffer.asUint8List());
}

/// Runs [body] and captures a screenshot if it throws.
Future<void> withFailureScreenshot(
  WidgetTester tester,
  String name,
  Future<void> Function() body,
) async {
  try {
    await body();
  } catch (_) {
    try {
      await saveFailureScreenshot(tester, name);
    } catch (_) {
      // Screenshot is best-effort; the original failure is what matters.
    }
    rethrow;
  }
}
