import 'dart:async';

import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';

/// Keeps the reading progress the API could not take when it was made, and
/// sends it once the API can be reached again.
///
/// Only the signed-in reader's own progress is sent, so a reader who signs in
/// on a device someone else read on offline never records that reading as
/// theirs.
class ProgressOutbox {
  ProgressOutbox({
    required this._origin,
    required this._library,
    required this._readerId,
  });

  /// The API itself, which a send goes to directly: sending through the
  /// offline repository would queue a failed send again.
  final CatalogRepository _origin;

  final OfflineLibrary _library;
  final String Function() _readerId;

  Future<void>? _flushing;
  var _again = false;

  /// Runs every send one after another, queued or live, so an older page
  /// being replayed can never reach the API after a newer one the viewer sent.
  Future<void> _sending = Future<void>.value();

  /// Bumped by every [queue], so a flush that found nothing can tell whether
  /// something arrived while it was reading.
  var _queued = 0;

  /// The reader whose queue was last found empty, so asking to flush after
  /// every request costs nothing until something is queued again.
  String? _emptyFor;

  /// Keeps [progress] until the API accepts it.
  Future<void> queue(UnsentProgress progress) {
    _queued++;
    _emptyFor = null;
    return _library.queueUnsentProgress(progress);
  }

  /// Sends [progress] straight to the API with [send], in turn with any
  /// flush, and drops whatever older page or finish of it is still queued once
  /// the API has accepted it.
  ///
  /// Whatever [send] throws is rethrown, and nothing is queued for it here.
  Future<void> send(UnsentProgress progress, Future<void> Function() send) {
    return _inTurn(() async {
      await send();
      if (_emptyFor != progress.readerId) {
        await _library.settleUnsentProgress(progress, newest: true);
      }
    });
  }

  /// The page [readerId] rested on in [episodePublicId] that the API has not
  /// taken yet, or `null` when none is queued.
  ///
  /// It is newer than anything the API answers with: sending it is what will
  /// make it the API's answer.
  Future<int?> queuedPage(String readerId, String episodePublicId) async {
    if (_emptyFor == readerId) {
      return null;
    }
    final unsent = await _library.readUnsentProgress(readerId: readerId);
    for (final progress in unsent) {
      if (progress.episodeId == episodePublicId) {
        return progress.pageIndex;
      }
    }
    return null;
  }

  /// Sends what the signed-in reader has queued.
  ///
  /// A call while a flush is running joins it and has it look once more, so
  /// what was queued in the meantime is not left for the next trigger.
  Future<void> flush() {
    final running = _flushing;
    if (running != null) {
      _again = true;
      return running;
    }
    return _flushing = _run();
  }

  /// Drops what [readerId] left unsent, which their signing out does.
  Future<void> forget(String readerId) {
    if (_emptyFor == readerId) {
      _emptyFor = null;
    }
    return _library.forgetUnsentProgress(readerId: readerId);
  }

  Future<void> _run() async {
    try {
      do {
        _again = false;
        await _inTurn(_pass);
      } while (_again);
    } finally {
      _flushing = null;
    }
  }

  Future<void> _pass() async {
    final reader = _readerId();
    if (reader.isEmpty || reader == _emptyFor) {
      return;
    }
    final queued = _queued;
    final unsent = await _library.readUnsentProgress(readerId: reader);
    if (unsent.isEmpty) {
      if (queued == _queued) {
        _emptyFor = reader;
      }
      return;
    }
    for (final progress in unsent) {
      if (progress.finished) {
        final finish = UnsentProgress(
          readerId: progress.readerId,
          episodeId: progress.episodeId,
          finished: true,
        );
        if (await _deliver(
              finish,
              () => _origin.markEpisodeAsRead(progress.episodeId),
            ) ==
            _Delivery.stop) {
          return;
        }
      }
      final pageIndex = progress.pageIndex;
      if (pageIndex != null) {
        final page = UnsentProgress(
          readerId: progress.readerId,
          episodeId: progress.episodeId,
          seriesId: progress.seriesId,
          pageIndex: pageIndex,
        );
        if (await _deliver(
              page,
              () => _origin.saveReadingPosition(
                progress.seriesId,
                progress.episodeId,
                pageIndex,
              ),
            ) ==
            _Delivery.stop) {
          return;
        }
      }
    }
  }

  /// Sends [part], and answers whether the flush goes on to the next one.
  Future<_Delivery> _deliver(
    UnsentProgress part,
    Future<void> Function() send,
  ) async {
    // The API reads the session's token in the same turn as this check, so
    // nothing goes out under a reader who did not make it.
    if (_readerId() != part.readerId) {
      return _Delivery.stop;
    }
    try {
      await send();
    } on CatalogFailure catch (failure) {
      if (failure.kind == CatalogFailureKind.network ||
          failure.kind == CatalogFailureKind.sessionExpired) {
        return _Delivery.stop;
      }
      // A server fault passes, so it is kept for the next flush; only this
      // entry waits for it, not the ones behind it.
      if (!failure.refused) {
        return _Delivery.kept;
      }
    } catch (_) {
      return _Delivery.stop;
    }
    // Accepted, or refused in a way every later send would be too.
    await _library.settleUnsentProgress(part);
    return _Delivery.sent;
  }

  Future<T> _inTurn<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _sending = _sending.then((_) async {
      try {
        completer.complete(await action());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }
}

enum _Delivery {
  /// The API took it or refused it for good, so it left the queue.
  sent,

  /// The API could not take it this time, and it stays for the next flush.
  kept,

  /// The API cannot be reached, or not as this reader, so the flush ends.
  stop,
}
