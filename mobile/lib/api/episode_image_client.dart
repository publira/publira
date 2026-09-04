import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/api/image_cipher.dart';

/// Why a body page could not be turned into image bytes.
enum EpisodeImageFailureKind {
  /// The request never produced a response, or timed out.
  network,

  /// image-server answered, but not with an image this build can read.
  response,

  /// The response was encrypted and this reader could not reverse it.
  decryption,
}

/// A body page that did not arrive as displayable bytes.
class EpisodeImageException implements Exception {
  const EpisodeImageException(this.kind, this.message);

  final EpisodeImageFailureKind kind;
  final String message;

  @override
  String toString() => 'EpisodeImageException(${kind.name}, $message)';
}

/// Fetches one body page from image-server, decrypting it when the response
/// says it is encrypted.
///
/// An encrypted page comes back as `application/octet-stream` with an
/// `X-Publira-Image-Encryption` stream that only the material the request
/// carried can reverse (see [decryptImageBytes]). For a body this reader is
/// entitled to, that material is the credential itself; for a free body it is
/// the media token the API put on the image URL, which is what lets a
/// signed-out reader recover the page. A response with no such header — every
/// page while image-server runs with `PUBLIRA_IMAGE_ENCRYPTION` off — is
/// passed through untouched.
class EpisodeImageClient {
  EpisodeImageClient({
    http.Client? httpClient,
    this.pages,
    this.timeout = const Duration(seconds: 20),
  }) : _http = httpClient ?? http.Client();

  /// What the app will accept for a page.
  ///
  /// image-server's converter negotiates the rendition from this header, and
  /// Flutter's codecs do not read AVIF, so the app asks for WebP and leaves
  /// AVIF out rather than taking whatever a browser would.
  static const imageAccept = 'image/webp,image/*;q=0.8,*/*;q=0.5';

  /// Where a page is kept once it has been turned into displayable bytes, and
  /// where one is read from when image-server cannot be reached. `null` on a
  /// run with nowhere to save, which reads online only.
  final EpisodePageStore? pages;

  final Duration timeout;
  final http.Client _http;

  /// Releases the connections this client holds. Anything still in flight is
  /// terminated, which is what a reader leaving an episode wants.
  void close() => _http.close();

  /// Loads [url] with [headers], which name the tenant and, when the reader
  /// is signed in, the reader.
  ///
  /// A page that cannot be fetched at all is read from [pages] instead, so an
  /// episode already on the device turns without a network. A page
  /// image-server did answer for is not: the server has spoken, and a refusal
  /// is not something the device may talk its way out of.
  Future<Uint8List> fetch(
    Uri url, {
    Map<String, String> headers = const {},
  }) async {
    late final http.Response response;
    try {
      response = await _http
          .get(url, headers: {...headers, 'accept': imageAccept})
          .timeout(timeout);
    } on TimeoutException {
      return _saved(url, 'image request timed out');
    } on IOException catch (error) {
      // Every `dart:io` failure of the request itself lands here, not only a
      // refused socket: `IOClient` re-throws a TLS `HandshakeException` as it
      // is, and a page the request never reached is a page to read off the
      // device.
      return _saved(url, '$error');
    } on http.ClientException catch (error) {
      return _saved(url, error.message);
    }

    if (response.statusCode != HttpStatus.ok) {
      throw EpisodeImageException(
        EpisodeImageFailureKind.response,
        'image request failed with ${response.statusCode}',
      );
    }
    final bytes = _decrypt(url, headers, response);
    final store = pages;
    if (store != null) {
      // Saving is not what the reader is waiting for, and a device that
      // cannot save still has the page in hand.
      unawaited(_save(store, episodePageKey(url), bytes));
    }
    return bytes;
  }

  /// Hands [bytes] to [store] without letting a refusal reach the zone.
  ///
  /// Nothing awaits this, so an escaping error would surface as a crash for a
  /// save the reader is not waiting on — and the store is an interface any
  /// implementation may satisfy, so the guarantee belongs here rather than in
  /// each of them.
  Future<void> _save(
    EpisodePageStore store,
    String key,
    Uint8List bytes,
  ) async {
    try {
      await store.writePage(key, bytes);
    } catch (_) {
      return;
    }
  }

  /// The saved page for [url], or the network failure [message] describes when
  /// this device holds none.
  Future<Uint8List> _saved(Uri url, String message) async {
    final store = pages;
    final saved = store == null
        ? null
        : await store.readPage(episodePageKey(url));
    if (saved != null && saved.isNotEmpty) {
      return saved;
    }
    throw EpisodeImageException(EpisodeImageFailureKind.network, message);
  }

  Uint8List _decrypt(
    Uri url,
    Map<String, String> headers,
    http.Response response,
  ) {
    // http lowercases response header names, matching the constants.
    final algorithm = response.headers[imageEncryptionHeader];
    if (algorithm == null) {
      return response.bodyBytes;
    }
    if (algorithm != imageEncryptionAlgorithm) {
      throw EpisodeImageException(
        EpisodeImageFailureKind.decryption,
        'unsupported image encryption algorithm: $algorithm',
      );
    }

    final contentType = response.headers[imageContentTypeHeader] ?? '';
    final keyId = response.headers[imageKeyIdHeader] ?? '';
    final token = _credential(url, headers);
    final subject = token == null ? null : subjectFromJwt(token);
    if (!contentType.startsWith('image/') ||
        keyId.isEmpty ||
        token == null ||
        subject == null) {
      throw const EpisodeImageException(
        EpisodeImageFailureKind.decryption,
        'encrypted image response is missing decryption metadata',
      );
    }

    return decryptImageBytes(
      ciphertext: response.bodyBytes,
      keyId: keyId,
      subject: subject,
      token: token,
    );
  }

  /// The JWT image-server derived the content key from.
  ///
  /// It resolves the request's own credential and prefers the `Authorization`
  /// header over the media token in the query, so the app has to read the two
  /// in the same order to arrive at the same key. A free body is what makes
  /// the second one reachable without a session: its URL carries a media token
  /// issued for the episode rather than for a reader, and a signed-out request
  /// sends no header for that token to lose to.
  String? _credential(Uri url, Map<String, String> headers) {
    for (final entry in headers.entries) {
      if (entry.key.toLowerCase() != 'authorization') {
        continue;
      }
      final value = entry.value.trim();
      if (value.toLowerCase().startsWith('bearer ')) {
        final token = value.substring('bearer '.length).trim();
        if (token.isNotEmpty) {
          return token;
        }
      }
    }
    final mediaToken = url.queryParameters[mediaTokenQueryParam]?.trim() ?? '';
    return mediaToken.isEmpty ? null : mediaToken;
  }
}
