import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:publira/crypto/xor_key_stream.dart';

/// Domain separator prefixed to the key input, keeping a saved file's key
/// apart from the one image-server derives for the same device. The trailing
/// NUL is part of the string, not a terminator.
const _offlineDomain = 'publira:offline:xor-hmac-sha256:v1\x00';

/// Encrypts or decrypts one saved file, which are the same call because
/// [applyXorKeyStream] is its own inverse.
///
/// [deviceKey] is the random key this install holds in the platform
/// credential store, and [label] names the file inside the library, so two
/// files never share a keystream even though they share the device key.
///
/// This protects what is written to the device's own storage rather than
/// anything the reader is not entitled to: a reader who may open the episode
/// necessarily holds the key that recovers it, the same way the delivery
/// stream works.
Uint8List transformOfflineBytes({
  required Uint8List bytes,
  required List<int> deviceKey,
  required String label,
}) {
  if (deviceKey.isEmpty || label.isEmpty) {
    throw ArgumentError('offline encryption needs a device key and a label');
  }
  final fileKey = Hmac(
    sha256,
    deviceKey,
  ).convert([...utf8.encode(_offlineDomain), ...utf8.encode(label)]).bytes;
  return applyXorKeyStream(bytes: bytes, key: fileKey);
}
