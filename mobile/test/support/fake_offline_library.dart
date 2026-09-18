import 'dart:async';
import 'dart:typed_data';

import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/tenant/tenant_brand.dart';

/// [OfflineLibrary] that keeps everything in memory.
///
/// `flutter test` has no app-private directory behind the file-backed one,
/// and a test asserting what the app saved wants to read it back without
/// going through the encrypted files.
class InMemoryOfflineLibrary implements OfflineLibrary {
  String tenantHost = '';
  TenantBrand? tenant;
  SeriesPage? series;
  final Map<String, SeriesDetail> details = {};
  final Map<String, SavedEpisode> episodes = {};
  final Map<String, SavedReadingPosition> positions = {};
  final Map<String, Uint8List> pages = {};

  final _changes = StreamController<void>.broadcast();

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<SeriesPage?> readSeriesList() async => series;

  @override
  Future<void> writeSeriesList(SeriesPage page) async {
    series = SeriesPage(
      series: List<SeriesItem>.unmodifiable(page.series),
      nextToken: page.nextToken,
    );
  }

  @override
  Future<TenantBrand?> readTenantBrand(String tenantHost) async =>
      this.tenantHost == tenantHost ? tenant : null;

  @override
  Future<void> writeTenantBrand(String tenantHost, TenantBrand brand) async {
    this.tenantHost = tenantHost;
    tenant = brand;
  }

  @override
  Future<SeriesDetail?> readSeriesDetail(String seriesPublicId) async =>
      details[seriesPublicId];

  @override
  Future<void> writeSeriesDetail(SeriesDetail detail) async {
    details[detail.series.id] = detail;
  }

  @override
  Future<void> removeSeries(String seriesPublicId) async {
    details.remove(seriesPublicId);
    positions.removeWhere(
      (key, position) => key.startsWith('$seriesPublicId/'),
    );
    for (final episode in episodes.values.toList(growable: false)) {
      if (episode.detail.seriesId != seriesPublicId) {
        continue;
      }
      episodes.remove(episode.key);
      for (final key in episode.pageKeys) {
        pages.remove(key);
      }
    }
    _changes.add(null);
  }

  @override
  Future<SavedEpisode?> readEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async => episodes[savedEpisodeKey(seriesPublicId, episodePublicId)];

  @override
  Future<void> writeEpisode(SavedEpisode episode) async {
    episodes[episode.key] = episode;
    _changes.add(null);
  }

  @override
  Future<void> removeEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    positions.remove(savedEpisodeKey(seriesPublicId, episodePublicId));
    final removed = episodes.remove(
      savedEpisodeKey(seriesPublicId, episodePublicId),
    );
    for (final key in removed?.pageKeys ?? const <String>[]) {
      pages.remove(key);
    }
    _changes.add(null);
  }

  @override
  Future<int?> readReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
  }) async {
    final saved = positions[savedEpisodeKey(seriesPublicId, episodePublicId)];
    return saved == null || saved.readerId != readerId ? null : saved.pageIndex;
  }

  @override
  Future<void> writeReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
    required int pageIndex,
  }) async {
    positions[savedEpisodeKey(seriesPublicId, episodePublicId)] =
        SavedReadingPosition(readerId: readerId, pageIndex: pageIndex);
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
            isReadableOffline(episode, readerId: readerId, now: at) &&
            episode.isWholeIn(pages.keys.toSet()))
          episode.detail.episode.id,
    };
  }

  @override
  Future<Uint8List?> readPage(String key) async => pages[key];

  @override
  Future<void> writePage(String key, Uint8List bytes) async {
    if (bytes.isEmpty) {
      return;
    }
    final added = !pages.containsKey(key);
    pages[key] = bytes;
    if (added &&
        episodes.values.any(
          (episode) =>
              episode.pageKeys.contains(key) &&
              episode.isWholeIn(pages.keys.toSet()),
        )) {
      _changes.add(null);
    }
  }

  @override
  Future<OfflineStorage> readStorage() async {
    final stored = [
      for (final episode in episodes.values)
        StoredEpisode(
          episode: episode,
          bytes: {
            for (final key in episode.pageKeys) key,
          }.fold(0, (sum, key) => sum + (pages[key]?.length ?? 0)),
          savedPages: {
            for (final key in episode.pageKeys) key,
          }.where(pages.containsKey).length,
        ),
    ]..sort((a, b) => b.episode.checkedAt.compareTo(a.episode.checkedAt));
    return OfflineStorage(
      bytes: pages.values.fold(0, (sum, page) => sum + page.length),
      byteLimit: offlineByteLimit,
      episodes: stored,
    );
  }

  @override
  Future<void> clear() async {
    tenantHost = '';
    tenant = null;
    series = null;
    details.clear();
    episodes.clear();
    positions.clear();
    pages.clear();
    _changes.add(null);
  }
}
