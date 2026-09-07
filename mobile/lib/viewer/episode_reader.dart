import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/viewer/episode_image.dart';
import 'package:publira/viewer/episode_page.dart';
import 'package:publira/viewer/page_spreads.dart';

/// Narrowest screen a spread is worth showing on, in logical pixels.
///
/// It is Material's medium window breakpoint: below it each half of a spread
/// is narrower than a phone shows a single page, so the pages would be smaller
/// than the reader can read rather than larger.
const _spreadMinWidth = 600.0;

/// How long a page turn started from a control or a tap takes. A swipe carries
/// its own timing from the gesture.
const _turnDuration = Duration(milliseconds: 200);

/// What one double tap magnifies to, and how far a pinch may go past it.
const _doubleTapScale = 2.5;
const _maxScale = 4.0;

/// Paged body reader.
///
/// Pages turn right to left, the way web-host's reader and a printed Japanese
/// volume do: the first page sits on the right and a swipe or a tap on the
/// left half advances. A page fills the viewport whole, and a reader who wants
/// a closer look at small lettering pinches or double taps into it.
class EpisodeReader extends StatefulWidget {
  const EpisodeReader({
    super.key,
    required this.images,
    required this.imageHeaders,
    this.imageClient,
    this.pageStore,
  });

  final List<EpisodeImageItem> images;
  final Map<String, String> imageHeaders;

  /// Fetches and decrypts the pages. The reader opens its own client when this
  /// is null, and closes only the one it opened.
  final EpisodeImageClient? imageClient;

  /// Where the client the reader opens keeps its pages, so this episode turns
  /// again without a network. Ignored when [imageClient] is given, which
  /// brings its own.
  final EpisodePageStore? pageStore;

  @override
  State<EpisodeReader> createState() => _EpisodeReaderState();
}

class _EpisodeReaderState extends State<EpisodeReader> {
  late final EpisodeImageClient _client;

  /// Decided once, beside the client it describes. Re-deriving it at disposal
  /// would read a `imageClient` the parent may have changed since, and then
  /// either leak the client this reader opened or close one it never owned.
  late final bool _ownsClient;

  /// The page the reader is on, not the screen it is shown on: a spread moves
  /// two pages onto one screen, and the position the reader keeps is a page of
  /// the episode.
  var _index = 0;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.imageClient == null;
    _client = widget.imageClient ?? EpisodeImageClient(pages: widget.pageStore);
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
    super.dispose();
  }

  /// Two pages share a screen only where both of them stay legible: a tablet,
  /// or a phone held sideways, which is the shape a printed spread has.
  bool _pairsPages(Size viewport) =>
      viewport.width >= _spreadMinWidth && viewport.width > viewport.height;

  /// Moves [delta] screens, so a spread advances by the two pages it shows.
  void _turn(PageSpreads spreads, int delta) {
    final target = spreads.spreadOf(_index) + delta;
    if (target < 0 || target >= spreads.length) {
      return;
    }
    setState(() {
      _index = spreads.firstPageOf(target);
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = Size(constraints.maxWidth, constraints.maxHeight);
        final spreads = PageSpreads(
          pageCount: widget.images.length,
          paired: _pairsPages(viewport),
        );
        final spread = spreads.spreadOf(_index);
        final pages = spreads.pagesAt(spread);
        return Stack(
          children: [
            _ReaderPager(
              // Turning the device rebuilds the pager rather than reusing it:
              // its controller counts screens, and pairing moves every page
              // but the cover onto a different screen.
              key: ValueKey(spreads.paired),
              spreads: spreads,
              images: widget.images,
              headers: widget.imageHeaders,
              client: _client,
              viewport: viewport,
              index: _index,
              onIndexChanged: (index) => setState(() {
                _index = index;
              }),
              onTurn: (delta) => _turn(spreads, delta),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _ReaderControls(
                firstPage: pages.first + 1,
                lastPage: pages.last + 1,
                pageCount: widget.images.length,
                onNext: spread < spreads.length - 1
                    ? () => _turn(spreads, 1)
                    : null,
                onPrevious: spread > 0 ? () => _turn(spreads, -1) : null,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The screens themselves: what a page turn moves through, and what a zoom
/// happens inside.
class _ReaderPager extends StatefulWidget {
  const _ReaderPager({
    super.key,
    required this.spreads,
    required this.images,
    required this.headers,
    required this.client,
    required this.viewport,
    required this.index,
    required this.onIndexChanged,
    required this.onTurn,
  });

  final PageSpreads spreads;
  final List<EpisodeImageItem> images;
  final Map<String, String> headers;
  final EpisodeImageClient client;
  final Size viewport;

  /// The page the reader is on. A change that does not come from a swipe turns
  /// the pager to the screen holding it.
  final int index;

  final ValueChanged<int> onIndexChanged;
  final ValueChanged<int> onTurn;

  @override
  State<_ReaderPager> createState() => _ReaderPagerState();
}

class _ReaderPagerState extends State<_ReaderPager> {
  late final PageController _controller = PageController(
    initialPage: widget.spreads.spreadOf(widget.index),
  );

  /// One transform for the whole pager, because only the screen on display can
  /// be zoomed and every turn puts it back to 1.0. Off-screen neighbours carry
  /// the same transform, which nobody can see and which is identity again by
  /// the time they are turned to.
  final _zoom = TransformationController();

  var _zoomed = false;
  Offset? _doubleTapPosition;

  @override
  void initState() {
    super.initState();
    _zoom.addListener(_handleZoomChanged);
  }

  @override
  void didUpdateWidget(covariant _ReaderPager oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.index == oldWidget.index) {
      return;
    }
    // Assigning the flag first keeps the listener from calling `setState`
    // while this element is rebuilding; the build that follows reads it.
    _zoomed = false;
    _zoom.value = Matrix4.identity();
    final target = widget.spreads.spreadOf(widget.index);
    if (!_controller.hasClients || _controller.page?.round() == target) {
      return;
    }
    _controller.animateToPage(
      target,
      duration: _turnDuration,
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _zoom.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _handleZoomChanged() {
    final zoomed = _zoom.value.getMaxScaleOnAxis() > 1;
    if (zoomed == _zoomed) {
      return;
    }
    setState(() {
      _zoomed = zoomed;
    });
  }

  /// Reading order runs right to left, so the left half of the screen is where
  /// the next page comes from.
  ///
  /// A tap while zoomed is part of looking around the page rather than a page
  /// turn; the double tap that zoomed in is what gets the reader back out.
  void _handleTap(double dx) {
    if (_zoomed || widget.viewport.width <= 0) {
      return;
    }
    widget.onTurn(dx < widget.viewport.width / 2 ? 1 : -1);
  }

  void _handleDoubleTap() {
    final position = _doubleTapPosition;
    if (_zoomed || position == null) {
      _zoom.value = Matrix4.identity();
      return;
    }
    // Scaling about the origin moves what was tapped out by (scale - 1) of its
    // offset, so translate it back and the page magnifies around the finger.
    // The offset is inside the viewport, so the page still covers it whole.
    _zoom.value = Matrix4.identity()
      ..translateByDouble(
        -position.dx * (_doubleTapScale - 1),
        -position.dy * (_doubleTapScale - 1),
        0,
        1,
      )
      ..scaleByDouble(_doubleTapScale, _doubleTapScale, _doubleTapScale, 1);
  }

  Widget _page(int index, Size viewport) => EpisodePage(
    image: widget.images[index],
    viewport: viewport,
    headers: widget.headers,
    client: widget.client,
  );

  Widget _screen(List<int> pages) {
    final viewport = Size(
      widget.viewport.width / pages.length,
      widget.viewport.height,
    );
    if (pages.length == 1) {
      return _page(pages.single, viewport);
    }
    return Row(
      // The pages of a spread are in reading order, so the first of them is
      // the one on the right.
      textDirection: TextDirection.rtl,
      children: [
        for (final page in pages) Expanded(child: _page(page, viewport)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTapUp: (details) => _handleTap(details.localPosition.dx),
      onDoubleTapDown: (details) => _doubleTapPosition = details.localPosition,
      onDoubleTap: _handleDoubleTap,
      child: PageView.builder(
        key: const ValueKey('episode-page-view'),
        controller: _controller,
        // Right to left, matching the reading direction.
        reverse: true,
        // A zoomed page is panned, not swiped: dropping the scroll physics
        // hands the drag to the viewer underneath instead of leaving the two
        // to fight over it.
        physics: _zoomed ? const NeverScrollableScrollPhysics() : null,
        itemCount: widget.spreads.length,
        onPageChanged: (spread) =>
            widget.onIndexChanged(widget.spreads.firstPageOf(spread)),
        itemBuilder: (context, spread) => InteractiveViewer(
          transformationController: _zoom,
          // Panning is what a zoomed page needs; at 1.0 the page is whole on
          // screen and a drag belongs to the page turn.
          panEnabled: _zoomed,
          maxScale: _maxScale,
          child: _screen(widget.spreads.pagesAt(spread)),
        ),
      ),
    );
  }
}

class _ReaderControls extends StatelessWidget {
  const _ReaderControls({
    required this.firstPage,
    required this.lastPage,
    required this.pageCount,
    required this.onNext,
    required this.onPrevious,
  });

  /// The pages on screen, one-based and equal outside a spread.
  final int firstPage;
  final int lastPage;

  final int pageCount;
  final VoidCallback? onNext;
  final VoidCallback? onPrevious;

  String _status(AppMessages messages) {
    final total = messages.formatInteger(pageCount);
    if (firstPage == lastPage) {
      return messages.viewerPageStatus(
        page: messages.formatInteger(firstPage),
        total: total,
      );
    }
    return messages.viewerPageStatusRange(
      first: messages.formatInteger(firstPage),
      last: messages.formatInteger(lastPage),
      total: total,
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
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
              tooltip: messages.viewerNextPage,
              color: Colors.white,
              disabledColor: Colors.white30,
              onPressed: onNext,
              icon: const Icon(Icons.chevron_left),
            ),
            Text(
              key: const ValueKey('episode-page-status'),
              _status(messages),
              style: const TextStyle(color: Colors.white),
            ),
            IconButton(
              key: const ValueKey('episode-previous-page'),
              tooltip: messages.viewerPreviousPage,
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
