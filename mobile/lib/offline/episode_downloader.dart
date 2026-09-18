import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_library.dart';

/// Why an episode could not be saved for offline reading.
enum EpisodeDownloadFailureKind {
  /// The API or image-server could not be reached or failed, so trying again
  /// may work.
  network,

  /// The API answered, but not with a body this reader may keep: the episode
  /// is locked, withheld for an age, or gone.
  notReadable,

  /// The pages arrived and the device did not keep them: it is full, or this
  /// platform has nowhere to write.
  storage,
}

class EpisodeDownloadFailure implements Exception {
  const EpisodeDownloadFailure(this.kind, {this.message = ''});

  final EpisodeDownloadFailureKind kind;

  /// Diagnostic only, never shown to the reader.
  final String message;

  @override
  String toString() => 'EpisodeDownloadFailure($kind, $message)';
}

/// Saves a whole episode on the device when the reader asks for it, rather
/// than page by page as they happen to read it.
///
/// It reads the episode through [CatalogRepository.getEpisode], which is what
/// files the body under the reader it was granted to, then fetches every page
/// through an [EpisodeImageClient] that keeps them. A save outlives the screen
/// that started it, so the progress lives here and not in that screen.
class EpisodeDownloader extends ChangeNotifier {
  EpisodeDownloader({
    required this._catalog,
    required this._library,
    this._openImages,
  });

  final CatalogRepository _catalog;
  final OfflineLibrary _library;

  /// Opens the client one save fetches its pages with, which a test replaces
  /// to answer the requests itself. The client has to keep what it fetches in
  /// the same library, which the default one does.
  final EpisodeImageClient Function()? _openImages;

  /// Share of pages fetched so far, keyed by [savedEpisodeKey].
  final _progress = <String, double>{};
  final _running = <String, Future<void>>{};

  /// Whether any episode is being saved right now.
  bool get isSaving => _progress.isNotEmpty;

  /// How far the save of this episode has come, from 0 to 1, or `null` when
  /// none is running.
  double? progressOf(String seriesPublicId, String episodePublicId) =>
      _progress[savedEpisodeKey(seriesPublicId, episodePublicId)];

  /// Saves the episode with all its pages.
  ///
  /// A second call for an episode already being saved joins the first rather
  /// than fetching every page twice.
  ///
  /// Throws [EpisodeDownloadFailure].
  Future<void> save(String seriesPublicId, String episodePublicId) {
    final key = savedEpisodeKey(seriesPublicId, episodePublicId);
    return _running[key] ??= _save(key, seriesPublicId, episodePublicId);
  }

  Future<void> _save(
    String key,
    String seriesPublicId,
    String episodePublicId,
  ) async {
    _progress[key] = 0;
    notifyListeners();
    final images = _openImages?.call() ?? EpisodeImageClient(pages: _library);
    try {
      final EpisodeDetail? detail;
      try {
        detail = await _catalog.getEpisode(seriesPublicId, episodePublicId);
      } on CatalogFailure catch (failure) {
        throw EpisodeDownloadFailure(
          EpisodeDownloadFailureKind.network,
          message: '$failure',
        );
      }
      if (detail == null ||
          (detail.access != EpisodeAccess.free &&
              detail.access != EpisodeAccess.entitled)) {
        throw EpisodeDownloadFailure(
          EpisodeDownloadFailureKind.notReadable,
          message: 'access: ${detail?.access}',
        );
      }
      final pages = detail.images;
      for (var index = 0; index < pages.length; index++) {
        final url = pages[index].url;
        // An episode the reader turned through part of holds those pages
        // already, and finishing it fetches only the rest.
        if (await _library.readPage(episodePageKey(url)) == null) {
          try {
            await images.keep(url, headers: detail.imageRequestHeaders);
          } on EpisodeImageException catch (error) {
            throw EpisodeDownloadFailure(
              error.kind == EpisodeImageFailureKind.storage
                  ? EpisodeDownloadFailureKind.storage
                  : EpisodeDownloadFailureKind.network,
              message: '$error',
            );
          }
        }
        _progress[key] = (index + 1) / pages.length;
        notifyListeners();
      }
      // The catalog decides what the device keeps, and a body it would not
      // file under this reader is not one to report as saved.
      if (await _library.readEpisode(seriesPublicId, episodePublicId) == null) {
        throw const EpisodeDownloadFailure(
          EpisodeDownloadFailureKind.notReadable,
          message: 'the library did not keep the episode',
        );
      }
    } finally {
      images.close();
      _progress.remove(key);
      unawaited(_running.remove(key));
      notifyListeners();
    }
  }
}
