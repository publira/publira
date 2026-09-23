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

  /// The API accepted a page or a finish sent straight to it, which drops
  /// whatever older one of the same kind is still queued.
  Future<void> settle(UnsentProgress sent) {
    if (_emptyFor == sent.readerId) {
      return Future<void>.value();
    }
    return _library.settleUnsentProgress(sent, newest: true);
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
        await _pass();
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
        if (!await _deliver(
          finish,
          () => _origin.markEpisodeAsRead(progress.episodeId),
        )) {
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
        if (!await _deliver(
          page,
          () => _origin.saveReadingPosition(
            progress.seriesId,
            progress.episodeId,
            pageIndex,
          ),
        )) {
          return;
        }
      }
    }
  }

  /// Sends [part] and answers whether the flush may go on to the next one.
  Future<bool> _deliver(
    UnsentProgress part,
    Future<void> Function() send,
  ) async {
    // The API reads the session's token in the same turn as this check, so
    // nothing goes out under a reader who did not make it.
    if (_readerId() != part.readerId) {
      return false;
    }
    try {
      await send();
    } on CatalogFailure catch (failure) {
      if (failure.kind == CatalogFailureKind.network ||
          failure.kind == CatalogFailureKind.sessionExpired) {
        return false;
      }
      // The API answered and turned it down, as it would every later send.
    } catch (_) {
      return false;
    }
    await _library.settleUnsentProgress(part);
    return true;
  }
}
