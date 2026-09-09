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
    this.initialPageIndex = 0,
    this.onPageChanged,
    this.endScreen,
    this.onNextEpisode,
    this.onPreviousEpisode,
    this.imageClient,
    this.pageStore,
  });

  final List<EpisodeImageItem> images;
  final Map<String, String> imageHeaders;

  /// The page the reader opens on, which is where they stopped last time.
  /// Read once: a reader who signs in halfway through an episode stays on the
  /// page they are looking at rather than being moved to the one the API
  /// answers for them.
  final int initialPageIndex;

  /// The reader moved to another page of the episode. It is not called for
  /// [initialPageIndex], which is the page they were already on.
  final ValueChanged<int>? onPageChanged;

  /// What the reader is shown once the pages run out, on the screen after the
  /// last one. Null leaves the body ending on its last page.
  final Widget? endScreen;

  /// Opens the episode either side of this one, null where the series has
  /// none there. They are what the controls along the bottom offer, so a
  /// reader moves on without going back through the series screen.
  final VoidCallback? onNextEpisode;
  final VoidCallback? onPreviousEpisode;

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
  late int _index;

  /// Whether the reader has turned past the last page, onto the end screen.
  /// It is not a page of the episode, so [_index] stays on the last one they
  /// read and the counter along the bottom keeps naming it.
  var _atEnd = false;

  @override
  void initState() {
    super.initState();
    _index = widget.initialPageIndex;
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

  /// How many screens the reader turns through: the episode's, plus the one
  /// the end panel takes.
  int _screenCount(PageSpreads spreads) =>
      spreads.length + (widget.endScreen == null ? 0 : 1);

  /// The screen on display, which is the end panel or the one holding the page
  /// the reader is on.
  int _screenOf(PageSpreads spreads) =>
      _atEnd ? spreads.length : spreads.spreadOf(_index);

  /// Moves [delta] screens, so a spread advances by the two pages it shows.
  void _turn(PageSpreads spreads, int delta) {
    final target = _screenOf(spreads) + delta;
    if (target < 0 || target >= _screenCount(spreads)) {
      return;
    }
    _showScreen(spreads, target);
  }

  /// Puts the reader on [screen], however it was turned to: a control, a tap,
  /// and a swipe all arrive here.
  void _showScreen(PageSpreads spreads, int screen) {
    if (screen < spreads.length) {
      _moveTo(spreads.firstPageOf(screen));
      return;
    }
    if (_atEnd) {
      return;
    }
    setState(() {
      _atEnd = true;
    });
  }

  /// Puts the reader on [index] and reports it once.
  ///
  /// Coming back from the end panel lands on the page the reader was already
  /// on, which is a screen to draw again and nothing to record: they never
  /// left the page the position names.
  void _moveTo(int index) {
    final turned = index != _index;
    if (!turned && !_atEnd) {
      return;
    }
    setState(() {
      _index = index;
      _atEnd = false;
    });
    if (turned) {
      widget.onPageChanged?.call(index);
    }
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
        final screen = _screenOf(spreads);
        final pages = spreads.pagesAt(spreads.spreadOf(_index));
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
              screen: screen,
              screenCount: _screenCount(spreads),
              endScreen: widget.endScreen,
              onScreenChanged: (screen) => _showScreen(spreads, screen),
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
                onNext: screen < _screenCount(spreads) - 1
                    ? () => _turn(spreads, 1)
                    : null,
                onPrevious: screen > 0 ? () => _turn(spreads, -1) : null,
                onNextEpisode: widget.onNextEpisode,
                onPreviousEpisode: widget.onPreviousEpisode,
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
    required this.screen,
    required this.screenCount,
    required this.endScreen,
    required this.onScreenChanged,
    required this.onTurn,
  });

  final PageSpreads spreads;
  final List<EpisodeImageItem> images;
  final Map<String, String> headers;
  final EpisodeImageClient client;
  final Size viewport;

  /// The screen on display. A change that does not come from a swipe turns the
  /// pager to it.
  final int screen;

  /// The screens there are, the end panel included.
  final int screenCount;

  /// Drawn on the screen after the last page, or null when the body ends
  /// there.
  final Widget? endScreen;

  final ValueChanged<int> onScreenChanged;
  final ValueChanged<int> onTurn;

  @override
  State<_ReaderPager> createState() => _ReaderPagerState();
}

class _ReaderPagerState extends State<_ReaderPager> {
  late final PageController _controller = PageController(
    initialPage: widget.screen,
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
    if (widget.screen == oldWidget.screen) {
      return;
    }
    // Assigning the flag first keeps the listener from calling `setState`
    // while this element is rebuilding; the build that follows reads it.
    _zoomed = false;
    _zoom.value = Matrix4.identity();
    if (!_controller.hasClients || _controller.page?.round() == widget.screen) {
      return;
    }
    _controller.animateToPage(
      widget.screen,
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

  Widget _pageScreen(List<int> pages) {
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
        itemCount: widget.screenCount,
        onPageChanged: widget.onScreenChanged,
        // The end panel is read rather than looked at, so it is drawn outside
        // the zoom the pages share.
        itemBuilder: (context, screen) => screen >= widget.spreads.length
            ? widget.endScreen
            : InteractiveViewer(
                transformationController: _zoom,
                // Panning is what a zoomed page needs; at 1.0 the page is
                // whole on screen and a drag belongs to the page turn.
                panEnabled: _zoomed,
                maxScale: _maxScale,
                child: _pageScreen(widget.spreads.pagesAt(screen)),
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
    required this.onNextEpisode,
    required this.onPreviousEpisode,
  });

  /// The pages on screen, one-based and equal outside a spread.
  final int firstPage;
  final int lastPage;

  final int pageCount;
  final VoidCallback? onNext;
  final VoidCallback? onPrevious;

  /// The episodes either side of this one, null where the series has none
  /// there, which is what leaves the control disabled.
  final VoidCallback? onNextEpisode;
  final VoidCallback? onPreviousEpisode;

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
            // Everything points the way the pages move, so on a right-to-left
            // reader "next" sits on the left and points left. The doubled
            // chevron is the longer move of the two: a whole episode rather
            // than a page.
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  key: const ValueKey('episode-next-episode'),
                  tooltip: messages.viewerNextEpisode,
                  color: Colors.white,
                  disabledColor: Colors.white30,
                  onPressed: onNextEpisode,
                  icon: const Icon(Icons.keyboard_double_arrow_left),
                ),
                IconButton(
                  key: const ValueKey('episode-next-page'),
                  tooltip: messages.viewerNextPage,
                  color: Colors.white,
                  disabledColor: Colors.white30,
                  onPressed: onNext,
                  icon: const Icon(Icons.chevron_left),
                ),
              ],
            ),
            Text(
              key: const ValueKey('episode-page-status'),
              _status(messages),
              style: const TextStyle(color: Colors.white),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  key: const ValueKey('episode-previous-page'),
                  tooltip: messages.viewerPreviousPage,
                  color: Colors.white,
                  disabledColor: Colors.white30,
                  onPressed: onPrevious,
                  icon: const Icon(Icons.chevron_right),
                ),
                IconButton(
                  key: const ValueKey('episode-previous-episode'),
                  tooltip: messages.viewerPreviousEpisode,
                  color: Colors.white,
                  disabledColor: Colors.white30,
                  onPressed: onPreviousEpisode,
                  icon: const Icon(Icons.keyboard_double_arrow_right),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
