import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/image_cipher.dart';

import 'support/jwt_fixture.dart';

const _pageUrl = 'http://images.test/media/PAGE0001';
const _keyId = 'cache-key-0001';

final _plaintext = Uint8List.fromList(
  List<int>.generate(200, (index) => index % 251),
);

void main() {
  final readerToken = jwtWithSubject('USRPUBLIC0001');
  final mediaToken = jwtWithSubject('USRPUBLIC0002');

  /// image-server's stream is its own inverse, so the fixtures are built with
  /// the very function under test. What pins that function to the server is
  /// the known-answer vector in `image_cipher_test.dart`.
  Uint8List encrypted(String token, String subject) => decryptImageBytes(
    ciphertext: _plaintext,
    keyId: _keyId,
    subject: subject,
    token: token,
  );

  Map<String, String> encryptionHeaders({
    String algorithm = imageEncryptionAlgorithm,
    String contentType = 'image/webp',
    String keyId = _keyId,
  }) => {
    imageEncryptionHeader: algorithm,
    imageContentTypeHeader: contentType,
    imageKeyIdHeader: keyId,
  };

  EpisodeImageClient clientAnswering(
    Future<http.Response> Function(http.Request request) handler,
  ) => EpisodeImageClient(httpClient: MockClient(handler));

  test('fetch passes an unencrypted page through untouched', () async {
    final client = clientAnswering(
      (_) async => http.Response.bytes(
        _plaintext,
        200,
        headers: const {'content-type': 'image/webp'},
      ),
    );

    expect(await client.fetch(Uri.parse(_pageUrl)), _plaintext);
  });

  test(
    'fetch decrypts a page authorized by the Authorization header',
    () async {
      final client = clientAnswering(
        (_) async => http.Response.bytes(
          encrypted(readerToken, 'USRPUBLIC0001'),
          200,
          headers: encryptionHeaders(),
        ),
      );

      final bytes = await client.fetch(
        Uri.parse(_pageUrl),
        headers: {'authorization': 'Bearer $readerToken'},
      );

      expect(bytes, _plaintext);
    },
  );

  test(
    'fetch decrypts a page authorized by the media token in the URL',
    () async {
      final client = clientAnswering(
        (_) async => http.Response.bytes(
          encrypted(mediaToken, 'USRPUBLIC0002'),
          200,
          headers: encryptionHeaders(),
        ),
      );

      final bytes = await client.fetch(
        Uri.parse('$_pageUrl?$mediaTokenQueryParam=$mediaToken'),
      );

      expect(bytes, _plaintext);
    },
  );

  test('fetch prefers the Authorization header over the media token', () async {
    // image-server reads the two in that order and derives the key from the
    // one it picked, so a URL carrying both still decrypts with the header.
    final client = clientAnswering(
      (_) async => http.Response.bytes(
        encrypted(readerToken, 'USRPUBLIC0001'),
        200,
        headers: encryptionHeaders(),
      ),
    );

    final bytes = await client.fetch(
      Uri.parse('$_pageUrl?$mediaTokenQueryParam=$mediaToken'),
      headers: {'authorization': 'Bearer $readerToken'},
    );

    expect(bytes, _plaintext);
  });

  test('fetch asks for a rendition this app can decode', () async {
    String? accept;
    final client = clientAnswering((request) async {
      accept = request.headers['accept'];
      return http.Response.bytes(_plaintext, 200);
    });

    await client.fetch(Uri.parse(_pageUrl));

    // Flutter has no AVIF codec, so the converter must not be offered one.
    expect(accept, isNotNull);
    expect(accept, contains('image/webp'));
    expect(accept, isNot(contains('image/avif')));
  });

  test('fetch sends the tenant and reader headers it was given', () async {
    Map<String, String>? sent;
    final client = clientAnswering((request) async {
      sent = request.headers;
      return http.Response.bytes(_plaintext, 200);
    });

    await client.fetch(
      Uri.parse(_pageUrl),
      headers: {
        'x-forwarded-host': 'localhost',
        'authorization': 'Bearer $readerToken',
      },
    );

    expect(sent?['x-forwarded-host'], 'localhost');
    expect(sent?['authorization'], 'Bearer $readerToken');
  });

  test(
    'fetch rejects an encryption algorithm this build cannot reverse',
    () async {
      final client = clientAnswering(
        (_) async => http.Response.bytes(
          _plaintext,
          200,
          headers: encryptionHeaders(algorithm: 'aes-gcm-v2'),
        ),
      );

      await expectLater(
        client.fetch(
          Uri.parse(_pageUrl),
          headers: {'authorization': 'Bearer $readerToken'},
        ),
        throwsA(
          isA<EpisodeImageException>().having(
            (error) => error.kind,
            'kind',
            EpisodeImageFailureKind.decryption,
          ),
        ),
      );
    },
  );

  test('fetch rejects an encrypted page missing its key id', () async {
    final client = clientAnswering(
      (_) async => http.Response.bytes(
        encrypted(readerToken, 'USRPUBLIC0001'),
        200,
        headers: encryptionHeaders(keyId: ''),
      ),
    );

    await expectLater(
      client.fetch(
        Uri.parse(_pageUrl),
        headers: {'authorization': 'Bearer $readerToken'},
      ),
      throwsA(isA<EpisodeImageException>()),
    );
  });

  test(
    'fetch rejects an encrypted page the request carries no key for',
    () async {
      final client = clientAnswering(
        (_) async => http.Response.bytes(
          encrypted(readerToken, 'USRPUBLIC0001'),
          200,
          headers: encryptionHeaders(),
        ),
      );

      await expectLater(
        client.fetch(Uri.parse(_pageUrl)),
        throwsA(
          isA<EpisodeImageException>().having(
            (error) => error.kind,
            'kind',
            EpisodeImageFailureKind.decryption,
          ),
        ),
      );
    },
  );

  test('fetch reports a page the server refused', () async {
    final client = clientAnswering((_) async => http.Response('denied', 403));

    await expectLater(
      client.fetch(Uri.parse(_pageUrl)),
      throwsA(
        isA<EpisodeImageException>().having(
          (error) => error.kind,
          'kind',
          EpisodeImageFailureKind.response,
        ),
      ),
    );
  });

  test('fetch reports an unreachable image server', () async {
    final client = clientAnswering((_) async {
      throw http.ClientException('connection refused');
    });

    await expectLater(
      client.fetch(Uri.parse(_pageUrl)),
      throwsA(
        isA<EpisodeImageException>().having(
          (error) => error.kind,
          'kind',
          EpisodeImageFailureKind.network,
        ),
      ),
    );
  });
}
