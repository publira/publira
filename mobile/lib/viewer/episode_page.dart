import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/viewer/page_fit.dart';

/// One page of the body, drawn inside the box [fitPageSize] reserves for it.
///
/// Fetching and decoding can fail on their own, so the page carries its own
/// loading and retry states instead of failing the whole episode.
class EpisodePage extends StatefulWidget {
  const EpisodePage({
    super.key,
    required this.image,
    required this.viewport,
    required this.headers,
  });

  final EpisodeImageItem image;
  final Size viewport;

  /// Sent with the image request so image-server can name the tenant and, for
  /// a paid body, the reader.
  final Map<String, String> headers;

  @override
  State<EpisodePage> createState() => _EpisodePageState();
}

class _EpisodePageState extends State<EpisodePage> {
  var _attempt = 0;

  NetworkImage get _provider =>
      NetworkImage(widget.image.url.toString(), headers: widget.headers);

  void _retry() {
    // A failed fetch stays in the image cache, so a rebuilt widget would show
    // the same error without going back to the network.
    unawaited(_provider.evict());
    setState(() {
      _attempt++;
    });
  }

  @override
  Widget build(BuildContext context) {
    final box = fitPageSize(
      viewport: widget.viewport,
      page: Size(widget.image.width.toDouble(), widget.image.height.toDouble()),
    );

    return Center(
      child: SizedBox.fromSize(
        size: box,
        child: Image(
          key: ValueKey('episode-page-${widget.image.id}-$_attempt'),
          image: _provider,
          fit: BoxFit.contain,
          gaplessPlayback: true,
          loadingBuilder: (context, child, progress) {
            if (progress == null) {
              return child;
            }
            return const Center(
              key: ValueKey('episode-page-loading'),
              child: CircularProgressIndicator(),
            );
          },
          errorBuilder: (context, error, stackTrace) => _PageError(
            key: const ValueKey('episode-page-error'),
            onRetry: _retry,
          ),
        ),
      ),
    );
  }
}

class _PageError extends StatelessWidget {
  const _PageError({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'このページを表示できませんでした',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            key: const ValueKey('episode-page-retry'),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: const BorderSide(color: Colors.white70),
            ),
            onPressed: onRetry,
            child: const Text('再読み込み'),
          ),
        ],
      ),
    );
  }
}
