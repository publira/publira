import 'dart:typed_data';

import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';

/// [OfflineLibrary] that keeps everything in memory.
///
/// `flutter test` has no app-private directory behind the file-backed one,
/// and a test asserting what the app saved wants to read it back without
/// going through the encrypted files.
class InMemoryOfflineLibrary implements OfflineLibrary {
  List<SeriesItem>? series;
  final Map<String, SeriesDetail> details = {};
  final Map<String, SavedEpisode> episodes = {};
  final Map<String, Uint8List> pages = {};

  @override
  Future<List<SeriesItem>?> readSeriesList() async => series;

  @override
  Future<void> writeSeriesList(List<SeriesItem> series) async {
    this.series = List<SeriesItem>.unmodifiable(series);
  }

  @override
  Future<SeriesDetail?> readSeriesDetail(String seriesPublicId) async =>
      details[seriesPublicId];

  @override
  Future<void> writeSeriesDetail(SeriesDetail detail) async {
    details[detail.series.id] = detail;
  }

  @override
  Future<void> removeSeriesDetail(String seriesPublicId) async {
    details.remove(seriesPublicId);
  }

  @override
  Future<SavedEpisode?> readEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async => episodes[savedEpisodeKey(seriesPublicId, episodePublicId)];

  @override
  Future<void> writeEpisode(SavedEpisode episode) async {
    episodes[episode.key] = episode;
  }

  @override
  Future<void> removeEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final removed = episodes.remove(
      savedEpisodeKey(seriesPublicId, episodePublicId),
    );
    for (final key in removed?.pageKeys ?? const <String>[]) {
      pages.remove(key);
    }
  }

  @override
  Future<Set<String>> readableEpisodeIds(
    String seriesPublicId, {
    required String readerId,
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    return {
      for (final episode in episodes.values)
        if (episode.detail.seriesId == seriesPublicId &&
            isReadableOffline(episode, readerId: readerId, now: at))
          episode.detail.episode.id,
    };
  }

  @override
  Future<Uint8List?> readPage(String key) async => pages[key];

  @override
  Future<void> writePage(String key, Uint8List bytes) async {
    pages[key] = bytes;
  }

  @override
  Future<void> clear() async {
    series = null;
    details.clear();
    episodes.clear();
    pages.clear();
  }
}
