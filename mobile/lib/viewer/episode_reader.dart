import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/viewer/episode_image.dart';
import 'package:publira/viewer/episode_page.dart';

/// Paged body reader.
///
/// Pages turn right to left, the way web-host's reader and a printed Japanese
/// volume do: the first page sits on the right and a swipe or a tap on the
/// left half advances. One page fills the viewport at a time, so a page is
/// never cropped and never needs pinch-zoom to be legible.
class EpisodeReader extends StatefulWidget {
  const EpisodeReader({
    super.key,
    required this.images,
    required this.imageHeaders,
    this.imageClient,
  });

  final List<EpisodeImageItem> images;
  final Map<String, String> imageHeaders;

  /// Fetches and decrypts the pages. The reader opens its own client when this
  /// is null, and closes only the one it opened.
  final EpisodeImageClient? imageClient;

  @override
  State<EpisodeReader> createState() => _EpisodeReaderState();
}

class _EpisodeReaderState extends State<EpisodeReader> {
  final _controller = PageController();
  late final EpisodeImageClient _client;

  /// Decided once, beside the client it describes. Re-deriving it at disposal
  /// would read a `imageClient` the parent may have changed since, and then
  /// either leak the client this reader opened or close one it never owned.
  late final bool _ownsClient;
  var _index = 0;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.imageClient == null;
    _client = widget.imageClient ?? EpisodeImageClient();
  }

  @override
  void dispose() {
    // A decoded page is megabytes of pixels, and the image cache is shared by
    // the whole app: hand the episode's pages back when the reader closes
    // instead of leaving them to age out behind whatever is read next.
    for (final image in widget.images) {
      unawaited(
        EpisodeImage(
          image.url,
          headers: widget.imageHeaders,
          client: _client,
        ).evict(),
      );
    }
    if (_ownsClient) {
      _client.close();
    }
    _controller.dispose();
    super.dispose();
  }

  bool get _hasPrevious => _index > 0;

  bool get _hasNext => _index < widget.images.length - 1;

  void _turn(int delta) {
    final target = _index + delta;
    if (target < 0 || target >= widget.images.length) {
      return;
    }
    _controller.animateToPage(
      target,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  /// Reading order runs right to left, so the left half of the screen is where
  /// the next page comes from.
  void _handleTap(double dx, double width) {
    if (width <= 0) {
      return;
    }
    _turn(dx < width / 2 ? 1 : -1);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = Size(constraints.maxWidth, constraints.maxHeight);
        return Stack(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTapUp: (details) =>
                  _handleTap(details.localPosition.dx, viewport.width),
              child: PageView.builder(
                key: const ValueKey('episode-page-view'),
                controller: _controller,
                // Right to left, matching the reading direction.
                reverse: true,
                itemCount: widget.images.length,
                onPageChanged: (index) {
                  setState(() {
                    _index = index;
                  });
                },
                itemBuilder: (context, index) => EpisodePage(
                  image: widget.images[index],
                  viewport: viewport,
                  headers: widget.imageHeaders,
                  client: _client,
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _ReaderControls(
                page: _index + 1,
                pageCount: widget.images.length,
                onNext: _hasNext ? () => _turn(1) : null,
                onPrevious: _hasPrevious ? () => _turn(-1) : null,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ReaderControls extends StatelessWidget {
  const _ReaderControls({
    required this.page,
    required this.pageCount,
    required this.onNext,
    required this.onPrevious,
  });

  final int page;
  final int pageCount;
  final VoidCallback? onNext;
  final VoidCallback? onPrevious;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black54,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // The chevrons point the way the pages move, so on a right-to-left
            // reader "next" sits on the left and points left.
            IconButton(
              key: const ValueKey('episode-next-page'),
              tooltip: '次のページ',
              color: Colors.white,
              disabledColor: Colors.white30,
              onPressed: onNext,
              icon: const Icon(Icons.chevron_left),
            ),
            Text(
              key: const ValueKey('episode-page-status'),
              '$page / $pageCount',
              style: const TextStyle(color: Colors.white),
            ),
            IconButton(
              key: const ValueKey('episode-previous-page'),
              tooltip: '前のページ',
              color: Colors.white,
              disabledColor: Colors.white30,
              onPressed: onPrevious,
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
      ),
    );
  }
}
