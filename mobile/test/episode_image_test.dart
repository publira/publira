import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/image_cipher.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/viewer/episode_image.dart';
import 'package:publira/viewer/episode_reader.dart';

import 'support/jwt_fixture.dart';

/// A 4x4 opaque PNG, small enough to inline and real enough for the engine to
/// decode into a frame.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGM4'
  'EaDxHxkzkC4AAMJ4I/G8zaebAAAAAElFTkSuQmCC',
);

const _keyId = 'cache-key-0001';

final _page = EpisodeImageItem(
  id: 'PAGE0001',
  url: Uri.parse('http://images.test/images/episodes/PAGE0001'),
  displayOrder: 1,
  width: 4,
  height: 4,
);

void main() {
  final readerToken = jwtWithSubject('USRPUBLIC0001');
  final headers = {
    'x-forwarded-host': 'localhost',
    'authorization': 'Bearer $readerToken',
  };

  TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() => imageCache.clear());

  testWidgets('an encrypted page is decrypted and drawn', (tester) async {
    final client = EpisodeImageClient(
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          decryptImageBytes(
            ciphertext: _png,
            keyId: _keyId,
            subject: 'USRPUBLIC0001',
            token: readerToken,
          ),
          200,
          headers: const {
            imageEncryptionHeader: imageEncryptionAlgorithm,
            imageContentTypeHeader: 'image/png',
            imageKeyIdHeader: _keyId,
          },
        ),
      ),
    );

    await _pumpReader(tester, client: client, headers: headers);
    final drawn = await _drawnImage(tester);

    expect(drawn, isNotNull);
    expect(drawn?.width, 4);
    expect(find.byKey(const ValueKey('episode-page-error')), findsNothing);
  });

  testWidgets('a plaintext page is drawn the same way', (tester) async {
    // The reader has to keep working while image-server runs with
    // `PUBLIRA_IMAGE_ENCRYPTION` off and answers with the image itself.
    final client = EpisodeImageClient(
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          _png,
          200,
          headers: const {'content-type': 'image/png'},
        ),
      ),
    );

    await _pumpReader(tester, client: client, headers: headers);

    expect((await _drawnImage(tester))?.width, 4);
  });

  testWidgets('a page that cannot be decrypted offers a retry', (tester) async {
    // The response claims a stream this build cannot reverse, so the page
    // fails on its own rather than taking the reader down with it.
    final client = EpisodeImageClient(
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          _png,
          200,
          headers: const {
            imageEncryptionHeader: 'aes-gcm-v2',
            imageContentTypeHeader: 'image/png',
            imageKeyIdHeader: _keyId,
          },
        ),
      ),
    );

    await _pumpReader(tester, client: client, headers: headers);
    await tester.pump();

    expect(find.byKey(const ValueKey('episode-page-error')), findsOneWidget);
    expect(find.byKey(const ValueKey('episode-page-retry')), findsOneWidget);
    expect(find.byKey(const ValueKey('episode-page-view')), findsOneWidget);
  });

  test('two providers for the same page under the same credential match', () {
    final client = EpisodeImageClient(
      httpClient: MockClient((_) async => http.Response('', 404)),
    );
    final provider = EpisodeImage(_page.url, headers: headers, client: client);
    final same = EpisodeImage(
      _page.url,
      headers: Map.of(headers),
      // A second transport does not make it a second page.
      client: EpisodeImageClient(
        httpClient: MockClient((_) async => http.Response('', 404)),
      ),
    );

    expect(provider, same);
    expect(provider.hashCode, same.hashCode);
  });

  test('a provider for another reader is a different cache entry', () {
    final client = EpisodeImageClient(
      httpClient: MockClient((_) async => http.Response('', 404)),
    );
    final provider = EpisodeImage(_page.url, headers: headers, client: client);

    expect(
      provider,
      isNot(
        EpisodeImage(
          _page.url,
          headers: {...headers, 'authorization': 'Bearer other'},
          client: client,
        ),
      ),
    );
    expect(
      provider,
      isNot(
        EpisodeImage(
          Uri.parse('${_page.url}?v=2'),
          headers: headers,
          client: client,
        ),
      ),
    );
  });

  test('a provider keeps the media token out of what it prints', () {
    // The token in the query reads the paid body, so a failed page must not
    // write it into the device log or a crash report built from one.
    final token = jwtWithSubject('USRPUBLIC0001');
    final provider = EpisodeImage(
      Uri.parse('${_page.url}?$mediaTokenQueryParam=$token'),
      headers: headers,
      client: EpisodeImageClient(
        httpClient: MockClient((_) async => http.Response('', 404)),
      ),
    );

    expect(provider.toString(), isNot(contains(token)));
    expect(provider.toString(), isNot(contains('?')));
    expect(provider.toString(), contains(_page.url.path));
  });

  testWidgets('a reader never closes a client it was handed', (tester) async {
    final client = _RecordingClient(
      MockClient(
        (_) async => http.Response.bytes(
          _png,
          200,
          headers: const {'content-type': 'image/png'},
        ),
      ),
    );

    await _pumpReader(
      tester,
      client: EpisodeImageClient(httpClient: client),
      headers: headers,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();

    expect(client.closed, isFalse);
  });

  testWidgets('a reader that was handed a client keeps not owning it', (
    tester,
  ) async {
    // Ownership is settled when the client is adopted. A parent that stops
    // passing one afterwards must not turn the reader into its owner.
    final client = _RecordingClient(
      MockClient(
        (_) async => http.Response.bytes(
          _png,
          200,
          headers: const {'content-type': 'image/png'},
        ),
      ),
    );

    await _pumpReader(
      tester,
      client: EpisodeImageClient(httpClient: client),
      headers: headers,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: EpisodeReader(images: [_page], imageHeaders: headers),
      ),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();

    expect(client.closed, isFalse);
  });

  testWidgets('closing the reader releases its decoded pages', (tester) async {
    final client = EpisodeImageClient(
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          _png,
          200,
          headers: const {'content-type': 'image/png'},
        ),
      ),
    );

    await _pumpReader(tester, client: client, headers: headers);
    await _drawnImage(tester);
    expect(imageCache.currentSize, greaterThan(0));

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();

    expect(imageCache.currentSize, 0);
  });
}

/// Passes every request through and records whether it was ever closed.
class _RecordingClient extends http.BaseClient {
  _RecordingClient(this._inner);

  final http.Client _inner;
  var closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      _inner.send(request);

  @override
  void close() {
    closed = true;
    _inner.close();
  }
}

Future<void> _pumpReader(
  WidgetTester tester, {
  required EpisodeImageClient client,
  required Map<String, String> headers,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: EpisodeReader(
        images: [_page],
        imageHeaders: headers,
        imageClient: client,
      ),
    ),
  );
  await tester.pump();
}

/// The frame the page ended up drawing, or null if it never got one.
///
/// Fetching and decoding are real asynchronous work, so they only run inside
/// [WidgetTester.runAsync]; the pump in between is what lets the arriving
/// frame reach the widget.
Future<ui.Image?> _drawnImage(
  WidgetTester tester, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump();
    final raw = find.byType(RawImage).evaluate();
    if (raw.isNotEmpty) {
      final image = (raw.first.widget as RawImage).image;
      if (image != null) {
        return image;
      }
    }
  }
  return null;
}
