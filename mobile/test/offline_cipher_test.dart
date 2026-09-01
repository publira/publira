import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/offline/offline_cipher.dart';

final _deviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 7 % 256),
);

final _otherDeviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 11 % 256),
);

/// Longer than the 32-byte HMAC-SHA256 block, so the counter has to advance.
final _plaintext = Uint8List.fromList(
  List<int>.generate(200, (index) => index % 251),
);

void main() {
  test('transformOfflineBytes is its own inverse', () {
    final encrypted = transformOfflineBytes(
      bytes: _plaintext,
      deviceKey: _deviceKey,
      label: 'page/abc',
    );

    expect(encrypted, isNot(_plaintext));
    expect(
      transformOfflineBytes(
        bytes: encrypted,
        deviceKey: _deviceKey,
        label: 'page/abc',
      ),
      _plaintext,
    );
  });

  test('a saved file does not read under another device key', () {
    final encrypted = transformOfflineBytes(
      bytes: _plaintext,
      deviceKey: _deviceKey,
      label: 'page/abc',
    );

    expect(
      transformOfflineBytes(
        bytes: encrypted,
        deviceKey: _otherDeviceKey,
        label: 'page/abc',
      ),
      isNot(_plaintext),
    );
  });

  test('two files under one device key do not share a keystream', () {
    final first = transformOfflineBytes(
      bytes: _plaintext,
      deviceKey: _deviceKey,
      label: 'page/abc',
    );
    final second = transformOfflineBytes(
      bytes: _plaintext,
      deviceKey: _deviceKey,
      label: 'page/def',
    );

    expect(first, isNot(second));
  });

  test('an empty body comes back empty rather than failing', () {
    expect(
      transformOfflineBytes(
        bytes: Uint8List(0),
        deviceKey: _deviceKey,
        label: 'index',
      ),
      isEmpty,
    );
  });

  test('transformOfflineBytes rejects incomplete key material', () {
    expect(
      () => transformOfflineBytes(
        bytes: _plaintext,
        deviceKey: Uint8List(0),
        label: 'index',
      ),
      throwsArgumentError,
    );
    expect(
      () => transformOfflineBytes(
        bytes: _plaintext,
        deviceKey: _deviceKey,
        label: '',
      ),
      throwsArgumentError,
    );
  });
}
