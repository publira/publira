import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/viewer/episode_image.dart';
import 'package:publira/viewer/page_fit.dart';

/// One page of the body, drawn inside the box [fitPageSize] reserves for it.
///
/// Fetching and decoding can fail on their own, so the page carries its own
/// loading and retry states instead of failing the whole episode. A page whose
/// encrypted stream cannot be reversed fails the same way, and offers the same
/// retry, as a page whose fetch failed.
class EpisodePage extends StatefulWidget {
  const EpisodePage({
    super.key,
    required this.image,
    required this.viewport,
    required this.headers,
    required this.client,
  });

  final EpisodeImageItem image;
  final Size viewport;

  /// Sent with the image request so image-server can name the tenant and,
  /// when the reader is signed in, the reader.
  final Map<String, String> headers;

  /// Fetches the page, decrypting it when the response says it is encrypted.
  final EpisodeImageClient client;

  @override
  State<EpisodePage> createState() => _EpisodePageState();
}

class _EpisodePageState extends State<EpisodePage> {
  var _attempt = 0;

  EpisodeImage get _provider => EpisodeImage(
    widget.image.url,
    headers: widget.headers,
    client: widget.client,
  );

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
            error: error,
            onRetry: _retry,
          ),
        ),
      ),
    );
  }
}

class _PageError extends StatelessWidget {
  const _PageError({super.key, required this.error, required this.onRetry});

  /// What the page failed with, which tells a rate limit from the rest.
  final Object error;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final error = this.error;
    final rateLimit =
        error is EpisodeImageException &&
            error.kind == EpisodeImageFailureKind.rateLimited
        ? error
        : null;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AutospacedText(
              rateLimit == null
                  ? messages.viewerPageFailed
                  : messages.errorsRpcRateLimited,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white),
            ),
            const SizedBox(height: 12),
            RetryHold(
              key: ObjectKey(error),
              wait: rateLimit?.retryAfter,
              builder: (context, held) => OutlinedButton(
                key: const ValueKey('episode-page-retry'),
                // The page is drawn on black whatever the app's theme, so the
                // held button is dimmed against black too.
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  disabledForegroundColor: Colors.white38,
                  side: BorderSide(
                    color: held ? Colors.white24 : Colors.white70,
                  ),
                ),
                onPressed: held ? null : onRetry,
                child: AutospacedText(messages.viewerReload),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
