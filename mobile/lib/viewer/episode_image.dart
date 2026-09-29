import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:publira/api/episode_image_client.dart';

/// An [ImageProvider] for one body page, fetched and decrypted by
/// [EpisodeImageClient] instead of read straight off the network.
///
/// A body page can arrive encrypted, so `NetworkImage` cannot decode it.
/// Everything else a page needs from Flutter — the shared image cache,
/// `loadingBuilder`, `errorBuilder`, and [evict] on retry — works the same
/// way, because two providers naming the same URL under the same request
/// headers compare equal and therefore share one cache entry.
@immutable
class EpisodeImage extends ImageProvider<EpisodeImage> {
  const EpisodeImage(this.url, {required this.headers, required this.client});

  final Uri url;

  /// Sent with the request. They are part of this provider's identity because
  /// they name the tenant and the reader, and a different reader is served
  /// different bytes under a different key.
  final Map<String, String> headers;

  /// Transport only, so it stays out of [operator ==].
  final EpisodeImageClient client;

  @override
  Future<EpisodeImage> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture<EpisodeImage>(this);

  @override
  ImageStreamCompleter loadImage(
    EpisodeImage key,
    ImageDecoderCallback decode,
  ) {
    return MultiFrameImageStreamCompleter(
      codec: key._load(decode),
      scale: 1,
      debugLabel: key._loggableUrl,
      informationCollector: () => [
        ErrorDescription('Page URL: ${key._loggableUrl}'),
      ],
    );
  }

  /// The page URL with its query dropped, for anything that gets written down.
  ///
  /// A paid page carries its media token there, and that token reads the body:
  /// a failed page would otherwise leave a working credential in the device
  /// log and in any crash report that picks the log up.
  String get _loggableUrl => url.hasQuery
      ? Uri(
          scheme: url.scheme,
          host: url.host,
          port: url.hasPort ? url.port : null,
          path: url.path,
        ).toString()
      : url.toString();

  Future<ui.Codec> _load(ImageDecoderCallback decode) async {
    final Uint8List bytes = await client.fetch(url, headers: headers);
    if (bytes.isEmpty) {
      throw const EpisodeImageException(
        EpisodeImageFailureKind.response,
        'image response carried no bytes',
      );
    }
    // `decode` takes the buffer over, and the frames it returns are held by
    // the stream this completer owns: evicting the provider is what releases
    // the decoded page.
    return decode(await ui.ImmutableBuffer.fromUint8List(bytes));
  }

  @override
  bool operator ==(Object other) =>
      other is EpisodeImage &&
      other.url == url &&
      mapEquals(other.headers, headers);

  @override
  int get hashCode => Object.hash(
    url,
    Object.hashAllUnordered(
      headers.entries.map((entry) => Object.hash(entry.key, entry.value)),
    ),
  );

  @override
  String toString() => 'EpisodeImage("$_loggableUrl")';
}
