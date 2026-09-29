import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// XORs [bytes] with the HMAC-SHA256 keystream [key] generates.
///
/// The stream is the concatenation of `HMAC(key, counter)` blocks over a
/// big-endian 64-bit counter starting at zero. It is the one construction this
/// app shares between the pages image-server delivers
/// (`lib/api/image_cipher.dart`) and the pages it keeps for offline reading
/// (`lib/offline/offline_cipher.dart`): each derives its own key and hands it
/// here.
///
/// XOR is its own inverse, so the same call encrypts and decrypts.
Uint8List applyXorKeyStream({
  required Uint8List bytes,
  required List<int> key,
}) {
  final keyStream = Hmac(sha256, key);
  final out = Uint8List(bytes.length);
  final counter = Uint8List(8);
  var offset = 0;
  var block = 0;
  while (offset < bytes.length) {
    // Big-endian counter, written by hand because `ByteData.setUint64` is
    // unsupported on the web, which this app also builds for.
    var remaining = block;
    for (var i = 7; i >= 0; i--) {
      counter[i] = remaining & 0xff;
      remaining >>= 8;
    }
    final stream = keyStream.convert(counter).bytes;
    for (var i = 0; i < stream.length && offset < bytes.length; i++, offset++) {
      out[offset] = bytes[offset] ^ stream[i];
    }
    block++;
  }
  return out;
}
