import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/account_icon.dart';

import 'support/icon_images.dart';

void main() {
  test(
    'a JPEG, a PNG, and each form of WebP become an upload of their type',
    () {
      final images = {
        'image/jpeg': jpegIcon(width: 300, height: 200),
        'image/png': pngIcon(width: 300, height: 200),
        'image/webp': webpIcon(WebpForm.lossy, width: 300, height: 200),
      };
      for (final MapEntry(key: type, value: bytes) in images.entries) {
        final (upload, problem) = prepareAccountIcon(bytes);
        expect(problem, isNull, reason: type);
        expect(upload?.contentType, type);
        expect(upload?.bytes, same(bytes));
      }
      for (final form in WebpForm.values) {
        final (upload, problem) = prepareAccountIcon(
          webpIcon(form, width: 300, height: 200),
        );
        expect(problem, isNull, reason: '$form');
        expect(upload?.contentType, 'image/webp');
      }
    },
  );

  test('an image whose shorter side is under 128 px is too small', () {
    final images = <String, Uint8List Function(int width, int height)>{
      'JPEG': (width, height) => jpegIcon(width: width, height: height),
      'PNG': (width, height) => pngIcon(width: width, height: height),
      for (final form in WebpForm.values)
        '$form': (width, height) =>
            webpIcon(form, width: width, height: height),
    };
    for (final MapEntry(key: name, value: image) in images.entries) {
      expect(prepareAccountIcon(image(128, 128)).$2, isNull, reason: name);
      expect(
        prepareAccountIcon(image(127, 4000)).$2,
        AccountIconProblem.tooSmall,
        reason: name,
      );
      expect(
        prepareAccountIcon(image(4000, 127)).$2,
        AccountIconProblem.tooSmall,
        reason: name,
      );
    }
  });

  test('an image over 10 MiB is too large', () {
    final atLimit = pngIcon(padding: accountIconMaxBytes - 33);
    expect(atLimit.length, accountIconMaxBytes);
    expect(prepareAccountIcon(atLimit).$2, isNull);

    final over = pngIcon(padding: accountIconMaxBytes - 32);
    expect(prepareAccountIcon(over), (null, AccountIconProblem.tooLarge));
  });

  test('anything but a JPEG, a PNG, or a WebP is unsupported', () {
    final files = {
      'GIF': Uint8List.fromList([...ascii.encode('GIF89a'), 0, 1, 0, 1]),
      'HEIC': Uint8List.fromList([
        0x00, 0x00, 0x00, 0x18, ...ascii.encode('ftypheic'), //
        0x00, 0x00, 0x00, 0x00, ...ascii.encode('mif1heic'),
      ]),
      'empty': Uint8List(0),
      'a PNG cut short': pngIcon().sublist(0, 20),
      'a JPEG with no frame': jpegIcon().sublist(0, 27),
      'a WebP of an unknown form': Uint8List.fromList([
        ...ascii.encode('RIFF'), 0, 0, 0, 0, ...ascii.encode('WEBPVP8?'), //
        ...List.filled(20, 0),
      ]),
    };
    for (final MapEntry(key: name, value: bytes) in files.entries) {
      expect(prepareAccountIcon(bytes), (
        null,
        AccountIconProblem.unsupported,
      ), reason: name);
    }
  });
}
