import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/image_cipher.dart';

import 'support/jwt_fixture.dart';

/// Material of the known-answer vector below. It was produced by
/// `imageCipher` in `server/internal/imageserver`, so this file checks the two
/// implementations against each other rather than against themselves.
const _token = 'header.payload.signature';
const _subject = 'USRPUBLIC0001';
const _keyId = 'cache-key-0001';
const _plaintextHex =
    '7075626c69726120656e6372797074656420696d61676520746573742076656374'
    '6f7220000102feff20616e642061207461696c2070617374206f6e6520626c6f636b';
const _ciphertextHex =
    '282fcdcc595d1057c39ea73aae975637e2a6b2a026d1ee78c122c952fe3312167'
    '77f7d7c45c0b464e07018de6752464c70354c5551a1f829162d459031f0197730a63a';

void main() {
  test('decryptImageBytes reverses the stream image-server produced', () {
    expect(
      decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: _keyId,
        subject: _subject,
        token: _token,
      ),
      hexBytes(_plaintextHex),
    );
  });

  test('decryptImageBytes covers a body longer than one 32-byte block', () {
    // The vector runs 67 bytes, so a stream that stopped after its first block
    // would leave the tail unchanged.
    expect(hexBytes(_ciphertextHex).length, greaterThan(32));
    expect(
      decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: _keyId,
        subject: _subject,
        token: _token,
      ).sublist(32),
      hexBytes(_plaintextHex).sublist(32),
    );
  });

  test('decryptImageBytes derives a different key per credential', () {
    for (final wrong in [
      decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: _keyId,
        subject: _subject,
        token: 'header.payload.other',
      ),
      decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: _keyId,
        subject: 'USRPUBLIC0002',
        token: _token,
      ),
      decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: 'cache-key-0002',
        subject: _subject,
        token: _token,
      ),
    ]) {
      expect(wrong, isNot(hexBytes(_plaintextHex)));
    }
  });

  test('decryptImageBytes rejects incomplete key material', () {
    expect(
      () => decryptImageBytes(
        ciphertext: hexBytes(_ciphertextHex),
        keyId: '',
        subject: _subject,
        token: _token,
      ),
      throwsArgumentError,
    );
  });

  test('subjectFromJwt reads the sub claim without verifying the token', () {
    expect(subjectFromJwt(jwtWithSubject('USRPUBLIC0001')), 'USRPUBLIC0001');
  });

  test('subjectFromJwt returns null for a token it cannot read', () {
    expect(subjectFromJwt(''), isNull);
    expect(subjectFromJwt('not-a-jwt'), isNull);
    expect(subjectFromJwt('header.@@@.signature'), isNull);
    expect(subjectFromJwt(jwtWithSubject('')), isNull);
  });
}

Uint8List hexBytes(String hex) {
  final bytes = Uint8List(hex.length ~/ 2);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return bytes;
}
