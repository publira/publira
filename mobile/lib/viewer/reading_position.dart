import 'dart:async';

/// How long the reader stays on a page before it is worth recording.
///
/// A page turn is not a decision to stop there: a reader skimming forward
/// crosses ten pages in a couple of seconds, and each one would otherwise be a
/// request. The delay is short enough that the page a reader settles on is
/// recorded long before they leave, and [ReadingPositionSaver.flush] covers
/// the reader who leaves inside the window.
const readingPositionSaveDelay = Duration(milliseconds: 1500);

/// The page the viewer opens at, given where the reader stopped and how many
/// pages the episode holds now.
///
/// A saved page was measured against the episode as it was, so a body replaced
/// with a shorter one can leave a position past its end. That resumes on the
/// last page rather than on an index the reader has nothing to draw for.
int resumePageIndex(int? savedPageIndex, int pageCount) {
  if (savedPageIndex == null || savedPageIndex <= 0 || pageCount == 0) {
    return 0;
  }
  return savedPageIndex < pageCount - 1 ? savedPageIndex : pageCount - 1;
}

/// Collects page turns and records the page the reader rests on.
///
/// A page equal to the last one the API accepted is not sent again, and
/// turning back to it inside the delay drops what was waiting, so a reader
/// paging over the same spread produces one request rather than one per turn.
///
/// A page counts as recorded only once its send has succeeded. A send that is
/// still in flight, or one that failed, leaves the page unrecorded, so a
/// reader who turns away and back to it while it is being written sends it
/// again rather than resting on a write that may never land. The API takes
/// the same page twice as one position, which is what makes the extra send
/// cheaper than the lost one.
class ReadingPositionSaver {
  ReadingPositionSaver({
    required this.send,
    this.delay = readingPositionSaveDelay,
  });

  /// Records one page. Whatever it throws is the end of that attempt: a
  /// position is an improvement on opening at the first page, never something
  /// to interrupt the reader with.
  final Future<void> Function(int pageIndex) send;

  final Duration delay;

  Timer? _timer;
  int? _pending;

  /// The last page [send] answered for, which is the one the API is known to
  /// hold.
  int? _recorded;

  /// The reader is on [pageIndex] now.
  void save(int pageIndex) {
    _timer?.cancel();
    _timer = null;
    if (pageIndex == _recorded) {
      _pending = null;
      return;
    }
    _pending = pageIndex;
    _timer = Timer(delay, flush);
  }

  /// Sends what is waiting without waiting out the delay, which is what a
  /// reader leaving the episode does to the page they left on.
  void flush() {
    _timer?.cancel();
    _timer = null;
    final pageIndex = _pending;
    _pending = null;
    if (pageIndex == null) {
      return;
    }
    unawaited(_send(pageIndex));
  }

  /// Drops what is waiting. The reader is not leaving the page behind — the
  /// screen is going away with nothing left to record.
  void dispose() {
    _timer?.cancel();
    _timer = null;
    _pending = null;
  }

  Future<void> _send(int pageIndex) async {
    try {
      await send(pageIndex);
      _recorded = pageIndex;
    } catch (_) {
      // The page was not recorded, so nothing here says it was: turning to it
      // again sends it again rather than resting on a failed attempt.
    }
  }
}
