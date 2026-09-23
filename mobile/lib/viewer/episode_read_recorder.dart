import 'dart:async';

/// Records that the reader finished the episode, once.
///
/// Each arrival at the end asks for one send. A send in flight or one that
/// has succeeded answers every later arrival, so a reader paging back and
/// forth over the last page does not produce a request per turn. A send that
/// failed leaves the finish unrecorded, and the next arrival sends it again.
class EpisodeReadRecorder {
  EpisodeReadRecorder({required this.send});

  /// Records the finish. Whatever it throws is the end of that attempt: the
  /// record is the reader's history, never something to interrupt them with.
  final Future<void> Function() send;

  var _sending = false;
  var _recorded = false;

  /// The reader has arrived at the end of the episode.
  void record() {
    if (_sending || _recorded) {
      return;
    }
    _sending = true;
    unawaited(_send());
  }

  Future<void> _send() async {
    try {
      await send();
      _recorded = true;
    } catch (_) {
      // Left unrecorded, so the next arrival at the end tries again.
    } finally {
      _sending = false;
    }
  }
}
