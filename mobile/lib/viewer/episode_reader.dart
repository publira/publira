import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';
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
/// Pages turn the way the episode is bound: right to left unless it says
/// otherwise, with pairing from [spreadStartIndex]. A page fills the viewport
/// whole, and a reader who wants a closer look at small lettering pinches or
/// double taps into it.
class EpisodeReader extends StatefulWidget {
  const EpisodeReader({
    super.key,
    required this.images,
    required this.imageHeaders,
    this.initialPageIndex = 0,
    this.onPageChanged,
    this.onFinished,
    this.endScreen,
    this.onNextEpisode,
    this.onPreviousEpisode,
    this.imageClient,
    this.pageStore,
    this.readingDirection = ReadingDirection.rtl,
    this.spreadStartIndex = 1,
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

  /// The last page came on screen, or the end screen past it, from anywhere
  /// short of both. It is called for an episode opened on its last page too,
  /// and for a turn of the device that pairs the last page onto the screen.
  final VoidCallback? onFinished;

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

  /// Which way the pages are turned, taken from the episode read.
  final ReadingDirection readingDirection;

  /// The page from which two pages share a screen, taken from the episode
  /// read. Every page before it stands alone.
  final int spreadStartIndex;

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

  /// Whether the screen on display holds the last page or the end screen, as
  /// of the last build.
  var _finished = false;

  /// Where the progress slider's thumb is while the reader drags it, in
  /// [_positionOf] units and anywhere between two of them; null otherwise.
  /// The pager follows it, and nothing is recorded until it is let go.
  double? _scrub;

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
    // The slider reaches the end panel from anywhere, and the reader who
    // lands there has passed the last spread on the way.
    final lastSpread = spreads.length - 1;
    final passed = spreads.spreadOf(_index) != lastSpread;
    if (_atEnd && !passed) {
      return;
    }
    final lastPage = spreads.firstPageOf(lastSpread);
    setState(() {
      _index = passed ? lastPage : _index;
      _atEnd = true;
    });
    if (passed) {
      widget.onPageChanged?.call(lastPage);
    }
  }

  /// The pages the counter names for [screen]. The end panel is named by the
  /// last spread, which is the one the reader has read by then.
  List<int> _pagesNamed(PageSpreads spreads, int screen) =>
      spreads.pagesAt(min(screen, spreads.length - 1));

  /// Where the progress slider puts [screen]: the page it starts from, or the
  /// page count for the end panel, so the track counts pages the way the
  /// position does and a spread takes the length of its two pages.
  int _positionOf(PageSpreads spreads, int screen) => screen < spreads.length
      ? spreads.firstPageOf(screen)
      : widget.images.length;

  /// The screen [position] falls on, with how far it has gone towards the
  /// next one as the fraction: the pager scrolls to it while a drag is held,
  /// and rounding it gives the screen a release there lands on.
  double _screenAt(PageSpreads spreads, double position) {
    final screen = position >= widget.images.length
        ? spreads.length
        : spreads.spreadOf(position.floor());
    if (screen + 1 >= _screenCount(spreads)) {
      return screen.toDouble();
    }
    final start = _positionOf(spreads, screen);
    final next = _positionOf(spreads, screen + 1);
    return screen + (position - start) / (next - start);
  }

  void _scrubTo(double position) {
    setState(() {
      _scrub = position;
    });
  }

  void _endScrub(PageSpreads spreads, double position) {
    setState(() {
      _scrub = null;
    });
    _showScreen(spreads, _screenAt(spreads, position).round());
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

  /// Reports the arrival at the end once the frame that shows it is drawn.
  /// Only a layout says which pages share the screen, so this is noted from
  /// the build rather than from a page turn.
  void _noteFinished(bool finished) {
    if (finished == _finished) {
      return;
    }
    _finished = finished;
    if (!finished || widget.onFinished == null) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onFinished?.call();
      }
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
          spreadStartIndex: widget.spreadStartIndex,
        );
        final screen = _screenOf(spreads);
        final screenCount = _screenCount(spreads);
        final pages = _pagesNamed(spreads, screen);
        _noteFinished(_atEnd || pages.last == widget.images.length - 1);
        final scrub = _scrub;
        final scrubScreen = scrub == null ? null : _screenAt(spreads, scrub);
        return Stack(
          children: [
            _ReaderPager(
              // Turning the device rebuilds the pager rather than reusing it:
              // its controller counts screens, and pairing moves every page
              // but the cover onto a different screen.
              key: ValueKey((
                spreads.paired,
                spreads.spreadStartIndex,
                widget.readingDirection,
              )),
              spreads: spreads,
              images: widget.images,
              headers: widget.imageHeaders,
              client: _client,
              viewport: viewport,
              screen: screen,
              screenCount: screenCount,
              endScreen: widget.endScreen,
              readingDirection: widget.readingDirection,
              scrubScreen: scrubScreen,
              onScreenChanged: (screen) => _showScreen(spreads, screen),
              onTurn: (delta) => _turn(spreads, delta),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _ReaderControls(
                // The counter names the spread a release would land on.
                pages: scrubScreen == null
                    ? pages
                    : _pagesNamed(spreads, scrubScreen.round()),
                nextPages: screen < screenCount - 1
                    ? _pagesNamed(spreads, screen + 1)
                    : null,
                previousPages: screen > 0
                    ? _pagesNamed(spreads, screen - 1)
                    : null,
                pageCount: widget.images.length,
                progress: scrub ?? _positionOf(spreads, screen).toDouble(),
                progressEnd: _positionOf(spreads, screenCount - 1),
                onScrub: _scrubTo,
                onScrubEnd: (position) => _endScrub(spreads, position),
                readingDirection: widget.readingDirection,
                onNext: screen < screenCount - 1
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
    required this.readingDirection,
    required this.scrubScreen,
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

  final ReadingDirection readingDirection;

  /// Where a drag of the progress slider holds the pager, part of the way to
  /// the next screen between two of them, or null while nothing is held.
  /// The screens it crosses are not reported: the reader has not stopped on
  /// them, and the release reports the one they land on through [screen].
  final double? scrubScreen;

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
    final scrub = widget.scrubScreen;
    if (scrub != null) {
      if (oldWidget.scrubScreen == null) {
        _resetZoom();
      }
      if (scrub != oldWidget.scrubScreen) {
        _scrollTo(scrub);
      }
      return;
    }
    // A released drag leaves the pager wherever the thumb was, part of the
    // way from the screen it lands on even when that is the screen it
    // started from, so the pager is moved the rest of the way. A swipe has
    // already reported the screen it is settling on, and is left to finish.
    final released = oldWidget.scrubScreen != null;
    if (widget.screen == oldWidget.screen && !released) {
      return;
    }
    _resetZoom();
    final page = _controller.hasClients ? _controller.page : null;
    if (page == null ||
        (released ? page : page.round()) == widget.screen.toDouble()) {
      return;
    }
    _controller.animateToPage(
      widget.screen,
      duration: _turnDuration,
      curve: Curves.easeOut,
    );
  }

  /// Assigning the flag first keeps the listener from calling `setState`
  /// while this element is rebuilding; the build that follows reads it.
  void _resetZoom() {
    _zoomed = false;
    _zoom.value = Matrix4.identity();
  }

  @override
  void dispose() {
    _zoom.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _scrollTo(double screen) {
    if (_controller.hasClients) {
      _controller.jumpTo(screen * _controller.position.viewportDimension);
    }
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

  /// The next page comes from the side reading runs toward: the left half
  /// when the episode is right to left, the right half when it is left to
  /// right.
  ///
  /// A tap while zoomed is part of looking around the page rather than a page
  /// turn; the double tap that zoomed in is what gets the reader back out.
  void _handleTap(double dx) {
    if (_zoomed || widget.viewport.width <= 0) {
      return;
    }
    final nextOnLeft = widget.readingDirection == ReadingDirection.rtl;
    final onLeft = dx < widget.viewport.width / 2;
    widget.onTurn(onLeft == nextOnLeft ? 1 : -1);
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
      // The pages of a spread are in reading order, so the first of them sits
      // on the side reading starts from.
      textDirection: widget.readingDirection == ReadingDirection.rtl
          ? TextDirection.rtl
          : TextDirection.ltr,
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
        reverse: widget.readingDirection == ReadingDirection.rtl,
        // A zoomed page is panned, not swiped: dropping the scroll physics
        // hands the drag to the viewer underneath instead of leaving the two
        // to fight over it.
        physics: _zoomed ? const NeverScrollableScrollPhysics() : null,
        itemCount: widget.screenCount,
        onPageChanged: (screen) {
          if (widget.scrubScreen == null) {
            widget.onScreenChanged(screen);
          }
        },
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
    required this.pages,
    required this.nextPages,
    required this.previousPages,
    required this.pageCount,
    required this.progress,
    required this.progressEnd,
    required this.onScrub,
    required this.onScrubEnd,
    required this.readingDirection,
    required this.onNext,
    required this.onPrevious,
    required this.onNextEpisode,
    required this.onPreviousEpisode,
  });

  /// The pages the counter names, and those of the screens either side,
  /// which a screen reader announces an adjustment of the slider with. Null
  /// where there is no screen on that side.
  final List<int> pages;
  final List<int>? nextPages;
  final List<int>? previousPages;

  final int pageCount;

  /// Where the progress slider's thumb is, and where its track ends, in the
  /// reader's positions: a page from the one it starts at, and the end panel
  /// one past the last page.
  final double progress;
  final int progressEnd;

  /// The thumb was dragged to a position, and let go at one.
  final ValueChanged<double> onScrub;
  final ValueChanged<double> onScrubEnd;

  final ReadingDirection readingDirection;
  final VoidCallback? onNext;
  final VoidCallback? onPrevious;

  /// The episodes either side of this one, null where the series has none
  /// there, which is what leaves the control disabled.
  final VoidCallback? onNextEpisode;
  final VoidCallback? onPreviousEpisode;

  String _status(AppMessages messages, List<int> pages) {
    final total = messages.formatInteger(pageCount);
    final first = messages.formatInteger(pages.first + 1);
    if (pages.length == 1) {
      return messages.viewerPageStatus(page: first, total: total);
    }
    return messages.viewerPageStatusRange(
      first: first,
      last: messages.formatInteger(pages.last + 1),
      total: total,
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final rtl = readingDirection == ReadingDirection.rtl;
    // Icons point the way the pages move. They are not placed through
    // Directionality: Material's chevrons match text direction and would
    // flip under it, pointing the wrong way.
    final nextPageIcon = rtl ? Icons.chevron_left : Icons.chevron_right;
    final previousPageIcon = rtl ? Icons.chevron_right : Icons.chevron_left;
    final nextEpisodeIcon = rtl
        ? Icons.keyboard_double_arrow_left
        : Icons.keyboard_double_arrow_right;
    final previousEpisodeIcon = rtl
        ? Icons.keyboard_double_arrow_right
        : Icons.keyboard_double_arrow_left;
    final nextButtons = [
      AutospacedTooltip(
        message: messages.viewerNextEpisode,
        child: IconButton(
          key: const ValueKey('episode-next-episode'),
          color: Colors.white,
          disabledColor: Colors.white30,
          onPressed: onNextEpisode,
          icon: Icon(nextEpisodeIcon),
        ),
      ),
      AutospacedTooltip(
        message: messages.viewerNextPage,
        child: IconButton(
          key: const ValueKey('episode-next-page'),
          color: Colors.white,
          disabledColor: Colors.white30,
          onPressed: onNext,
          icon: Icon(nextPageIcon),
        ),
      ),
    ];
    final previousButtons = [
      AutospacedTooltip(
        message: messages.viewerPreviousPage,
        child: IconButton(
          key: const ValueKey('episode-previous-page'),
          color: Colors.white,
          disabledColor: Colors.white30,
          onPressed: onPrevious,
          icon: Icon(previousPageIcon),
        ),
      ),
      AutospacedTooltip(
        message: messages.viewerPreviousEpisode,
        child: IconButton(
          key: const ValueKey('episode-previous-episode'),
          color: Colors.white,
          disabledColor: Colors.white30,
          onPressed: onPreviousEpisode,
          icon: Icon(previousEpisodeIcon),
        ),
      ),
    ];
    final status = _status(messages, pages);
    final next = nextPages;
    final previous = previousPages;
    return Container(
      color: Colors.black54,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (progressEnd > 0)
              _ProgressSlider(
                value: progress,
                max: progressEnd,
                label: messages.viewerProgress,
                status: status,
                nextStatus: next == null ? null : _status(messages, next),
                previousStatus: previous == null
                    ? null
                    : _status(messages, previous),
                readingDirection: readingDirection,
                onScrub: onScrub,
                onScrubEnd: onScrubEnd,
                onNext: onNext,
                onPrevious: onPrevious,
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Next sits on the side the next page comes from, so a
                // right-to-left reader finds it on the left. The doubled
                // chevron is the longer move of the two: a whole episode
                // rather than a page.
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: rtl
                      ? nextButtons
                      : previousButtons.reversed.toList(),
                ),
                AutospacedText(
                  key: const ValueKey('episode-page-status'),
                  status,
                  style: const TextStyle(color: Colors.white),
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: rtl
                      ? previousButtons
                      : nextButtons.reversed.toList(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Drags the reader to any screen of the episode, landing on the one nearest
/// the thumb once it is let go. The track fills the way the pages are read.
class _ProgressSlider extends StatefulWidget {
  const _ProgressSlider({
    required this.value,
    required this.max,
    required this.label,
    required this.status,
    required this.nextStatus,
    required this.previousStatus,
    required this.readingDirection,
    required this.onScrub,
    required this.onScrubEnd,
    required this.onNext,
    required this.onPrevious,
  });

  final double value;
  final int max;
  final String label;

  /// The pages the thumb points at, which is what a screen reader hears as
  /// the slider's value instead of a share of the track.
  final String status;
  final String? nextStatus;
  final String? previousStatus;

  final ReadingDirection readingDirection;
  final ValueChanged<double> onScrub;
  final ValueChanged<double> onScrubEnd;

  /// What a screen reader's adjustment and an arrow key do: turn one screen,
  /// where Material's share of the track may not reach the next one.
  final VoidCallback? onNext;
  final VoidCallback? onPrevious;

  @override
  State<_ProgressSlider> createState() => _ProgressSliderState();
}

class _ProgressSliderState extends State<_ProgressSlider> {
  late final _focus = FocusNode(onKeyEvent: _handleKey);

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  /// The focused slider sees a key before Material's own shortcuts do.
  KeyEventResult _handleKey(FocusNode node, KeyEvent event) {
    if (event is KeyUpEvent) {
      return KeyEventResult.ignored;
    }
    final rtl = widget.readingDirection == ReadingDirection.rtl;
    final turn = switch (event.logicalKey) {
      LogicalKeyboardKey.arrowUp => widget.onNext,
      LogicalKeyboardKey.arrowDown => widget.onPrevious,
      LogicalKeyboardKey.arrowLeft => rtl ? widget.onNext : widget.onPrevious,
      LogicalKeyboardKey.arrowRight => rtl ? widget.onPrevious : widget.onNext,
      _ => null,
    };
    if (turn == null) {
      return KeyEventResult.ignored;
    }
    turn();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      slider: true,
      label: widget.label,
      value: widget.status,
      increasedValue: widget.nextStatus,
      decreasedValue: widget.previousStatus,
      onIncrease: widget.onNext,
      onDecrease: widget.onPrevious,
      excludeSemantics: true,
      child: Directionality(
        textDirection: widget.readingDirection == ReadingDirection.rtl
            ? TextDirection.rtl
            : TextDirection.ltr,
        child: Slider(
          key: const ValueKey('episode-progress'),
          focusNode: _focus,
          value: widget.value,
          max: widget.max.toDouble(),
          activeColor: Colors.white,
          inactiveColor: Colors.white30,
          onChanged: widget.onScrub,
          onChangeEnd: widget.onScrubEnd,
        ),
      ),
    );
  }
}
