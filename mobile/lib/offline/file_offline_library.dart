import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/device_key.dart';
import 'package:publira/offline/offline_cipher.dart';
import 'package:publira/offline/offline_json.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/tenant/tenant_brand.dart';

/// Resolves the directory the library writes under. Injected so a test can
/// point one at a temporary directory instead of the app's own.
typedef OfflineRootResolver = Future<Directory> Function();

/// [OfflineLibrary] over the app's private directory.
///
/// Metadata lives in one encrypted `index.json`, and each body page in its own
/// encrypted file under `pages/`. The index is one document because the byte
/// limit keeps a device to a few dozen episodes, and because eviction has to
/// see all of them at once to decide which to drop.
///
/// Nothing here throws. A device with no app-private directory, or with no
/// credential store to hold the key, reads online only; a file this build
/// cannot decrypt is treated as one the device does not have.
class FileOfflineLibrary implements OfflineLibrary {
  FileOfflineLibrary({
    required this.tenantHost,
    this._keys = const SecureDeviceKeyStore(),
    this._root = _applicationSupportRoot,
    this.byteLimit = offlineByteLimit,
  });

  /// The tenant this build reads for. Every tenant's build shares one
  /// application id, so an index written for another host can be on the
  /// device, and is dropped rather than answered.
  final String tenantHost;

  final DeviceKeyStore _keys;
  final OfflineRootResolver _root;

  /// Bytes of saved pages this device keeps before the least recently
  /// confirmed episodes are dropped.
  final int byteLimit;

  _Home? _home;
  Future<_Home?>? _opening;
  var _unavailable = false;

  OfflineIndex? _index;

  /// Size of `pages/` as last measured, kept so the limit is checked without
  /// walking the directory on every page. It runs high when a page is written
  /// over one already there, which costs an early sweep and nothing else:
  /// [_evict] measures from disk and puts the count back.
  int? _pageBytes;

  /// Serializes every call, so two screens writing at once cannot interleave
  /// a read of the index with the write of another.
  Future<void> _queue = Future<void>.value();

  final _changes = StreamController<void>.broadcast();

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<SeriesPage?> readSeriesList() {
    return _read<SeriesPage>((home, index) {
      final series = index.series;
      return series == null
          ? null
          : SeriesPage(
              series: List<SeriesItem>.unmodifiable(series),
              nextToken: index.seriesNextToken,
            );
    });
  }

  @override
  Future<void> writeSeriesList(SeriesPage page) {
    return _write((home, index) {
      index.series = List<SeriesItem>.unmodifiable(page.series);
      index.seriesNextToken = page.nextToken;
    });
  }

  @override
  Future<TenantBrand?> readTenantBrand(String tenantHost) {
    return _read<TenantBrand>(
      (home, index) => index.tenantHost == tenantHost ? index.tenant : null,
    );
  }

  @override
  Future<void> writeTenantBrand(String tenantHost, TenantBrand brand) {
    return _write((home, index) {
      if (index.tenantHost == tenantHost) {
        index.tenant = brand;
      }
    });
  }

  @override
  Future<SeriesDetail?> readSeriesDetail(String seriesPublicId) {
    return _read<SeriesDetail>((home, index) => index.details[seriesPublicId]);
  }

  @override
  Future<void> writeSeriesDetail(SeriesDetail detail) {
    return _write((home, index) {
      index.details[detail.series.id] = detail;
    });
  }

  @override
  Future<void> removeSeries(String seriesPublicId) {
    return _write((home, index) async {
      index.details.remove(seriesPublicId);
      // A position is keyed by `<series>/<episode>`, so the series' own
      // prefix is what its positions share, evicted episodes included.
      index.positions.removeWhere(
        (key, position) => key.startsWith('$seriesPublicId/'),
      );
      final dropped = index.episodes.values
          .where((episode) => episode.detail.seriesId == seriesPublicId)
          .toList(growable: false);
      for (final episode in dropped) {
        index.episodes.remove(episode.key);
        for (final key in episode.pageKeys) {
          await _deletePage(home, key);
        }
      }
      if (dropped.isNotEmpty) {
        _pageBytes = null;
      }
    }, notify: true);
  }

  @override
  Future<SavedEpisode?> readEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) {
    return _read<SavedEpisode>(
      (home, index) =>
          index.episodes[savedEpisodeKey(seriesPublicId, episodePublicId)],
    );
  }

  @override
  Future<void> writeEpisode(SavedEpisode episode) {
    return _write((home, index) {
      index.episodes[episode.key] = episode;
    }, notify: true);
  }

  @override
  Future<void> removeEpisode(String seriesPublicId, String episodePublicId) {
    return _write((home, index) async {
      final key = savedEpisodeKey(seriesPublicId, episodePublicId);
      index.positions.remove(key);
      final removed = index.episodes.remove(key);
      if (removed == null) {
        return;
      }
      for (final key in removed.pageKeys) {
        await _deletePage(home, key);
      }
      _pageBytes = null;
    }, notify: true);
  }

  @override
  Future<int?> readReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
  }) {
    return _read<int>((home, index) {
      final saved =
          index.positions[savedEpisodeKey(seriesPublicId, episodePublicId)];
      return saved == null || saved.readerId != readerId
          ? null
          : saved.pageIndex;
    });
  }

  @override
  Future<void> writeReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
    required int pageIndex,
  }) {
    return _write((home, index) {
      index.positions[savedEpisodeKey(seriesPublicId, episodePublicId)] =
          SavedReadingPosition(readerId: readerId, pageIndex: pageIndex);
    });
  }

  @override
  Future<List<UnsentProgress>> readUnsentProgress({
    required String readerId,
  }) async {
    final unsent = await _read<List<UnsentProgress>>(
      (home, index) => [
        for (final progress in index.unsent.values)
          if (progress.readerId == readerId) progress,
      ],
    );
    return unsent ?? const [];
  }

  @override
  Future<void> queueUnsentProgress(UnsentProgress progress) {
    return _write((home, index) {
      final queued = index.unsent[progress.key];
      index.unsent[progress.key] = queued == null
          ? progress
          : queued.mergedWith(progress);
    });
  }

  @override
  Future<void> settleUnsentProgress(
    UnsentProgress sent, {
    bool newest = false,
  }) {
    return _update((index) {
      final queued = index.unsent[sent.key];
      if (queued == null) {
        return false;
      }
      final left = queued.settledBy(sent, newest: newest);
      if (left.isEmpty) {
        index.unsent.remove(sent.key);
      } else {
        index.unsent[sent.key] = left;
      }
      return true;
    });
  }

  @override
  Future<void> forgetUnsentProgress({required String readerId}) {
    return _update((index) {
      final before = index.unsent.length;
      index.unsent.removeWhere(
        (key, progress) => progress.readerId == readerId,
      );
      return index.unsent.length != before;
    });
  }

  @override
  Future<Set<String>> readableEpisodeIds(
    String seriesPublicId, {
    required String readerId,
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    final ids = await _read<Set<String>>((home, index) async {
      final onDisk = await _listPageKeys(home);
      return {
        for (final episode in index.episodes.values)
          if (episode.detail.seriesId == seriesPublicId &&
              isReadableOffline(episode, readerId: readerId, now: at) &&
              episode.isWholeIn(onDisk))
            episode.detail.episode.id,
      };
    });
    return ids ?? const <String>{};
  }

  @override
  Future<Uint8List?> readPage(String key) {
    return _read<Uint8List>((home, index) async {
      final file = File(_pagePath(home, key));
      if (!await file.exists()) {
        return null;
      }
      final bytes = openOfflineBytes(
        sealed: await file.readAsBytes(),
        deviceKey: home.key,
        label: _pageLabel(key),
      );
      return bytes == null || bytes.isEmpty ? null : bytes;
    });
  }

  @override
  Future<void> writePage(String key, Uint8List bytes) {
    // Whether a page is saved is read off the file being there, so a page with
    // no bytes is never written: it would count towards a whole episode that
    // cannot draw it.
    if (bytes.isEmpty) {
      return Future<void>.value();
    }
    return _write((home, index) async {
      final sealed = sealOfflineBytes(
        plaintext: bytes,
        deviceKey: home.key,
        label: _pageLabel(key),
      );
      final file = File(_pagePath(home, key));
      final added = !await file.exists();
      await _writeFile(file, sealed);
      final known = _pageBytes;
      _pageBytes = known == null
          ? await _measurePages(home)
          : known + sealed.length;
      var changed = false;
      if (_pageBytes! > byteLimit) {
        final before = index.episodes.length;
        await _evict(home, index);
        await _writeIndex(home, index);
        changed = index.episodes.length != before;
      }
      if (!changed && added) {
        changed = await _completes(home, index, key);
      }
      if (changed) {
        _changes.add(null);
      }
    }, persist: false);
  }

  @override
  Future<OfflineStorage> readStorage() async {
    final storage = await _read<OfflineStorage>((home, index) async {
      final sizes = await _measurePageSizes(home);
      final episodes = [
        for (final episode in index.episodes.values) _stored(episode, sizes),
      ]..sort((a, b) => b.episode.checkedAt.compareTo(a.episode.checkedAt));
      final bytes = sizes.values.fold<int>(0, (sum, size) => sum + size);
      // Measured from disk anyway, so the running count starts true again.
      _pageBytes = bytes;
      return OfflineStorage(
        bytes: bytes,
        byteLimit: byteLimit,
        episodes: List.unmodifiable(episodes),
      );
    });
    return storage ??
        OfflineStorage(bytes: 0, byteLimit: byteLimit, episodes: const []);
  }

  @override
  Future<void> clear() {
    return _write((home, index) async {
      await _wipe(home);
      index
        ..tenant = null
        ..series = null
        ..details.clear()
        ..episodes.clear()
        ..positions.clear();
      _pageBytes = 0;
    }, notify: true);
  }

  StoredEpisode _stored(SavedEpisode episode, Map<String, int> sizes) {
    final keys = episode.pageKeys.toSet();
    return StoredEpisode(
      episode: episode,
      bytes: keys.fold<int>(0, (sum, key) => sum + (sizes[key] ?? 0)),
      savedPages: keys.where(sizes.containsKey).length,
    );
  }

  /// Drops what no episode claims any more, then the least recently confirmed
  /// episodes, until `pages/` fits under [byteLimit].
  Future<void> _evict(_Home home, OfflineIndex index) async {
    final sizes = await _measurePageSizes(home);
    final referenced = <String>{
      for (final episode in index.episodes.values) ...episode.pageKeys,
    };
    for (final key in sizes.keys.toList()) {
      if (!referenced.contains(key)) {
        await _deletePage(home, key);
        sizes.remove(key);
      }
    }

    var total = sizes.values.fold<int>(0, (sum, size) => sum + size);
    final oldestFirst = index.episodes.values.toList()
      ..sort((a, b) => a.checkedAt.compareTo(b.checkedAt));
    for (final episode in oldestFirst) {
      if (total <= byteLimit) {
        break;
      }
      for (final key in episode.pageKeys) {
        final size = sizes.remove(key);
        if (size == null) {
          continue;
        }
        await _deletePage(home, key);
        total -= size;
      }
      index.episodes.remove(episode.key);
      index.positions.remove(episode.key);
    }
    _pageBytes = total;
  }

  /// Whether the page [key], just added, was the last one some episode
  /// lacked.
  ///
  /// The screens mark an episode as saved only once it is whole, and the page
  /// that makes it whole arrives after the episode was filed.
  Future<bool> _completes(_Home home, OfflineIndex index, String key) async {
    final owners = index.episodes.values
        .where((episode) => episode.pageKeys.contains(key))
        .toList(growable: false);
    if (owners.isEmpty) {
      return false;
    }
    final onDisk = await _listPageKeys(home);
    return owners.any((episode) => episode.isWholeIn(onDisk));
  }

  Future<Set<String>> _listPageKeys(_Home home) async {
    final keys = <String>{};
    if (!await home.pages.exists()) {
      return keys;
    }
    await for (final entity in home.pages.list()) {
      if (entity is File) {
        keys.add(_pageKeyOf(entity));
      }
    }
    return keys;
  }

  Future<Map<String, int>> _measurePageSizes(_Home home) async {
    final sizes = <String, int>{};
    if (!await home.pages.exists()) {
      return sizes;
    }
    await for (final entity in home.pages.list()) {
      if (entity is File) {
        sizes[_pageKeyOf(entity)] = await entity.length();
      }
    }
    return sizes;
  }

  Future<int> _measurePages(_Home home) async {
    final sizes = await _measurePageSizes(home);
    return sizes.values.fold<int>(0, (sum, size) => sum + size);
  }

  Future<void> _deletePage(_Home home, String key) async {
    final file = File(_pagePath(home, key));
    if (await file.exists()) {
      await file.delete();
    }
  }

  String _pagePath(_Home home, String key) => '${home.pages.path}/$key.bin';

  String _pageLabel(String key) => 'page/$key';

  String _pageKeyOf(File file) {
    final name = file.uri.pathSegments.last;
    return name.endsWith('.bin')
        ? name.substring(0, name.length - '.bin'.length)
        : name;
  }

  Future<T?> _read<T extends Object>(
    FutureOr<T?> Function(_Home home, OfflineIndex index) action,
  ) {
    return _serialize<T?>(() async {
      final home = await _open();
      if (home == null) {
        return null;
      }
      try {
        return await action(home, await _readIndex(home));
      } catch (_) {
        // Reading is best effort: a device that cannot answer reads online.
        return null;
      }
    });
  }

  Future<void> _write(
    FutureOr<void> Function(_Home home, OfflineIndex index) action, {
    bool persist = true,
    bool notify = false,
  }) {
    return _serialize<void>(() async {
      final home = await _open();
      if (home == null) {
        return;
      }
      try {
        final index = await _readIndex(home);
        await action(home, index);
        if (persist) {
          await _writeIndex(home, index);
        }
        if (notify) {
          _changes.add(null);
        }
      } catch (_) {
        // Saving is best effort too: a full or unwritable device still reads.
        // What must not survive is a mutation `action` made to the cached
        // index whose write never landed, which would leave the screens
        // offering an episode that is not on the disk. Drop the cache so the
        // next read comes off the disk again.
        _index = null;
        _pageBytes = null;
      }
    });
  }

  /// [_write] for an [action] that answers whether it changed anything, so
  /// one that found nothing to change leaves the index file alone.
  ///
  /// The viewer settles every page it records, and the reader is online for
  /// almost all of them, with nothing queued to settle.
  Future<void> _update(bool Function(OfflineIndex index) action) {
    return _write((home, index) async {
      if (action(index)) {
        await _writeIndex(home, index);
      }
    }, persist: false);
  }

  Future<T> _serialize<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _queue = _queue.then((_) async {
      try {
        completer.complete(await action());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }

  Future<_Home?> _open() {
    if (_unavailable) {
      return Future<_Home?>.value();
    }
    final home = _home;
    if (home != null) {
      return Future<_Home?>.value(home);
    }
    return _opening ??= _openOnce();
  }

  Future<_Home?> _openOnce() async {
    try {
      final root = await _root();
      final home = _Home(root, await _keys.read());
      await home.pages.create(recursive: true);
      return _home = home;
    } catch (_) {
      // No app-private directory, or no credential store to hold the key.
      // Saving a page under a key that will not survive the launch is worse
      // than not saving it, so offline reading stays off for this run.
      _unavailable = true;
      return null;
    } finally {
      _opening = null;
    }
  }

  Future<OfflineIndex> _readIndex(_Home home) async {
    final cached = _index;
    if (cached != null) {
      return cached;
    }
    final file = File('${home.dir.path}/index.json');
    final present = await file.exists();
    OfflineIndex? index;
    if (present) {
      try {
        final bytes = openOfflineBytes(
          sealed: await file.readAsBytes(),
          deviceKey: home.key,
          label: 'index',
        );
        index = bytes == null
            ? null
            : OfflineIndex.fromJson(jsonDecode(utf8.decode(bytes)));
      } catch (_) {
        index = null;
      }
    }
    if (index != null && index.tenantHost != tenantHost) {
      // Written by a build for another tenant, whose bodies and positions
      // this one must not answer with.
      index = null;
    }
    if (index == null) {
      // The index is missing, unreadable, or another tenant's, so no page under
      // it can be told apart from another tenant's. The fresh index is written
      // at once, so a page saved from here on sits under one naming this host.
      await _wipe(home);
      index = OfflineIndex(tenantHost: tenantHost);
      await _writeIndex(home, index);
    }
    return _index = index;
  }

  Future<void> _writeIndex(_Home home, OfflineIndex index) async {
    final encoded = Uint8List.fromList(utf8.encode(jsonEncode(index.toJson())));
    await _writeFile(
      File('${home.dir.path}/index.json'),
      sealOfflineBytes(plaintext: encoded, deviceKey: home.key, label: 'index'),
    );
  }

  /// Writes [bytes] to [file] through a temporary neighbour and a rename.
  ///
  /// `writeAsBytes` truncates first, so a process that dies mid-write leaves
  /// the file holding a prefix of the new ciphertext. For the index that is
  /// fatal: it no longer decodes, and the library answers by wiping itself,
  /// pages included. A rename on the same filesystem is atomic, so whoever
  /// reads next sees either the old file whole or the new one whole.
  Future<void> _writeFile(File file, Uint8List bytes) async {
    final staged = File('${file.path}.writing');
    await staged.writeAsBytes(bytes, flush: true);
    await staged.rename(file.path);
  }

  Future<void> _wipe(_Home home) async {
    if (await home.dir.exists()) {
      await home.dir.delete(recursive: true);
    }
    await home.pages.create(recursive: true);
    _pageBytes = 0;
  }
}

class _Home {
  _Home(this.dir, this.key);

  final Directory dir;
  final Uint8List key;

  Directory get pages => Directory('${dir.path}/pages');
}

Future<Directory> _applicationSupportRoot() async {
  final support = await getApplicationSupportDirectory();
  return Directory('${support.path}/offline');
}
