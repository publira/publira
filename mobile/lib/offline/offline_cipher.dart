import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:publira/crypto/xor_key_stream.dart';

/// Domain separator prefixed to the key input, keeping a saved file's key
/// apart from the one image-server derives for the same device. The trailing
/// NUL is part of the string, not a terminator.
const _offlineDomain = 'publira:offline:xor-hmac-sha256:v1\x00';

/// Bytes of the nonce a sealed file carries in front of its ciphertext.
const offlineNonceLength = 16;

final _secureRandom = Random.secure();

/// Encrypts [plaintext] for the file [label] names inside the library.
///
/// The result is a fresh random nonce followed by the ciphertext. The nonce is
/// what keeps two writes of the same file apart: the keystream is a pure XOR
/// stream, so without it every version of `index.json` would be encrypted
/// under the same bytes, and whoever held two copies could XOR them together
/// and read the difference — which, for a document of known JSON shape, means
/// the episode ids and grants inside it.
///
/// [deviceKey] is the random key this install holds in the platform credential
/// store. Like the delivery stream, this protects what is written to the
/// device rather than anything the reader is not entitled to: whoever may open
/// the episode necessarily holds the key that recovers it.
Uint8List sealOfflineBytes({
  required Uint8List plaintext,
  required List<int> deviceKey,
  required String label,
  Random? random,
}) {
  final nonce = _nonce(random ?? _secureRandom);
  final ciphertext = applyXorKeyStream(
    bytes: plaintext,
    key: _fileKey(deviceKey, label, nonce),
  );
  final sealed = Uint8List(nonce.length + ciphertext.length);
  sealed.setRange(0, nonce.length, nonce);
  sealed.setRange(nonce.length, sealed.length, ciphertext);
  return sealed;
}

/// Reads back what [sealOfflineBytes] wrote, or `null` when [sealed] is too
/// short to carry a nonce at all.
///
/// A file sealed under another device key opens into bytes rather than into an
/// error, because the stream carries no authentication tag. What catches that
/// is the caller: the index fails to parse as JSON and the library wipes
/// itself, and a page fails to decode as an image and is fetched again.
Uint8List? openOfflineBytes({
  required Uint8List sealed,
  required List<int> deviceKey,
  required String label,
}) {
  if (sealed.length < offlineNonceLength) {
    return null;
  }
  return applyXorKeyStream(
    bytes: Uint8List.sublistView(sealed, offlineNonceLength),
    key: _fileKey(
      deviceKey,
      label,
      Uint8List.sublistView(sealed, 0, offlineNonceLength),
    ),
  );
}

List<int> _fileKey(List<int> deviceKey, String label, Uint8List nonce) {
  if (deviceKey.isEmpty || label.isEmpty) {
    throw ArgumentError('offline encryption needs a device key and a label');
  }
  return Hmac(sha256, deviceKey).convert([
    ...utf8.encode(_offlineDomain),
    ...utf8.encode(label),
    0,
    ...nonce,
  ]).bytes;
}

Uint8List _nonce(Random random) => Uint8List.fromList(
  List<int>.generate(offlineNonceLength, (_) => random.nextInt(256)),
);
