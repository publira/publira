import 'dart:math';
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

/// A nonce source a test can repeat, standing in for the secure one.
Random _fixedRandom() => Random(1);

Uint8List _seal({
  Uint8List? plaintext,
  Uint8List? deviceKey,
  String label = 'page/abc',
  Random? random,
}) => sealOfflineBytes(
  plaintext: plaintext ?? _plaintext,
  deviceKey: deviceKey ?? _deviceKey,
  label: label,
  random: random,
);

void main() {
  test('a sealed file opens back into the bytes that went in', () {
    final sealed = _seal();

    expect(sealed, hasLength(offlineNonceLength + _plaintext.length));
    expect(
      openOfflineBytes(
        sealed: sealed,
        deviceKey: _deviceKey,
        label: 'page/abc',
      ),
      _plaintext,
    );
  });

  test('two writes of the same file do not share a keystream', () {
    final first = _seal();
    final second = _seal();

    // Without a per-write nonce these would be identical, and whoever held
    // both copies could XOR them and read the difference.
    expect(first, isNot(second));
    expect(
      openOfflineBytes(
        sealed: second,
        deviceKey: _deviceKey,
        label: 'page/abc',
      ),
      _plaintext,
    );
  });

  test('a saved file does not open under another device key', () {
    final sealed = _seal(random: _fixedRandom());

    expect(
      openOfflineBytes(
        sealed: sealed,
        deviceKey: _otherDeviceKey,
        label: 'page/abc',
      ),
      isNot(_plaintext),
    );
  });

  test('two files under one device key do not share a keystream', () {
    final first = _seal(label: 'page/abc', random: _fixedRandom());
    final second = _seal(label: 'page/def', random: _fixedRandom());

    // Same nonce on purpose: what keeps these apart is the label.
    expect(first, isNot(second));
  });

  test('an empty body seals to its nonce and opens back empty', () {
    final sealed = _seal(plaintext: Uint8List(0));

    expect(sealed, hasLength(offlineNonceLength));
    expect(
      openOfflineBytes(
        sealed: sealed,
        deviceKey: _deviceKey,
        label: 'page/abc',
      ),
      isEmpty,
    );
  });

  test('a file too short to carry a nonce reads as absent', () {
    expect(
      openOfflineBytes(
        sealed: Uint8List(offlineNonceLength - 1),
        deviceKey: _deviceKey,
        label: 'page/abc',
      ),
      isNull,
    );
  });

  test('sealing rejects incomplete key material', () {
    expect(() => _seal(deviceKey: Uint8List(0)), throwsArgumentError);
    expect(() => _seal(label: ''), throwsArgumentError);
  });
}
