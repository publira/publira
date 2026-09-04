import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:publira/crypto/xor_key_stream.dart';

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
/// (`server/internal/auth`.`MediaTokenQueryParam`). On a body the reader is
/// entitled to it is issued for that reader; on a free one it is issued for
/// the episode and a rotation window, so every reader of that episode is
/// handed the same token and the page still decodes without a session.
const mediaTokenQueryParam = 't';

/// Domain separator the server prefixes to the key input. The trailing NUL is
/// part of the string, not a terminator.
const _encryptionDomain = 'publira:image:xor-hmac-sha256:v1\x00';

/// Reverses image-server's [imageEncryptionAlgorithm] stream.
///
/// The content key is derived from a JWT the reader already holds — the
/// credential the request was authorized with, or, for a free body, the media
/// token on its image URL — so the server never sends a key. This is
/// delivery-layer obfuscation rather than DRM: whoever may read the page
/// necessarily holds the material that recovers its pixels.
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
  return applyXorKeyStream(bytes: ciphertext, key: key);
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
