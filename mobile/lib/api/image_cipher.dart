import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// The single stream image-server speaks, as it names it in
/// `X-Publira-Image-Encryption`.
const imageEncryptionAlgorithm = 'xor-hmac-sha256-v1';

/// Response headers image-server sets on an encrypted rendition. The body then
/// arrives as `application/octet-stream`, so these carry everything needed to
/// turn it back into an image.
const imageEncryptionHeader = 'x-publira-image-encryption';
const imageContentTypeHeader = 'x-publira-image-content-type';
const imageKeyIdHeader = 'x-publira-image-key-id';

/// Query parameter holding the AudienceMedia token
/// (`server/internal/auth`.`MediaTokenQueryParam`).
const mediaTokenQueryParam = 't';

/// Domain separator the server prefixes to the key input. The trailing NUL is
/// part of the string, not a terminator.
const _encryptionDomain = 'publira:image:xor-hmac-sha256:v1\x00';

/// Reverses image-server's [imageEncryptionAlgorithm] stream.
///
/// The content key is derived from the very JWT the request was authorized
/// with, so an entitled reader can reproduce it without the server ever
/// sending a key. This is delivery-layer obfuscation rather than DRM: whoever
/// may read the page necessarily holds the material that recovers its pixels.
///
/// [keyId] is the server's cache key for the rendition, taken from
/// `X-Publira-Image-Key-Id`; [subject] is the `sub` claim of [token].
Uint8List decryptImageBytes({
  required Uint8List ciphertext,
  required String keyId,
  required String subject,
  required String token,
}) {
  if (keyId.isEmpty || subject.isEmpty || token.isEmpty) {
    throw ArgumentError('image decryption needs a token, a subject, and a key');
  }

  final key = Hmac(sha256, utf8.encode(token)).convert([
    ...utf8.encode(_encryptionDomain),
    ...utf8.encode(subject),
    0,
    ...utf8.encode(keyId),
  ]).bytes;
  final keyStream = Hmac(sha256, key);

  final plaintext = Uint8List(ciphertext.length);
  final counter = Uint8List(8);
  var offset = 0;
  var block = 0;
  while (offset < ciphertext.length) {
    // Big-endian counter, written by hand because `ByteData.setUint64` is
    // unsupported on the web, which this app also builds for.
    var remaining = block;
    for (var i = 7; i >= 0; i--) {
      counter[i] = remaining & 0xff;
      remaining >>= 8;
    }
    final stream = keyStream.convert(counter).bytes;
    for (
      var i = 0;
      i < stream.length && offset < ciphertext.length;
      i++, offset++
    ) {
      plaintext[offset] = ciphertext[offset] ^ stream[i];
    }
    block++;
  }
  return plaintext;
}

/// Reads the `sub` claim out of [token] without verifying its signature.
///
/// Only image-server verifies the token; the app already holds it and needs
/// nothing from it but the subject the server derived the key from. Returns
/// `null` for anything that is not a JWT carrying a non-empty `sub`.
String? subjectFromJwt(String token) {
  final parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  final payload = _decodeBase64Url(parts[1]);
  if (payload == null) {
    return null;
  }
  try {
    final Object? claims = jsonDecode(utf8.decode(payload));
    if (claims is Map) {
      final Object? subject = claims['sub'];
      if (subject is String && subject.isNotEmpty) {
        return subject;
      }
    }
  } on FormatException {
    return null;
  }
  return null;
}

Uint8List? _decodeBase64Url(String value) {
  final padding = (4 - value.length % 4) % 4;
  try {
    return base64Url.decode(value.padRight(value.length + padding, '='));
  } on FormatException {
    return null;
  }
}
