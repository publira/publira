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
    DeviceKeyStore keys = const SecureDeviceKeyStore(),
    OfflineRootResolver root = _applicationSupportRoot,
    this.byteLimit = offlineByteLimit,
  }) : _keys = keys,
       _root = root;

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

  @override
  Future<List<SeriesItem>?> readSeriesList() {
    return _read<List<SeriesItem>>((home, index) {
      final series = index.series;
      return series == null ? null : List<SeriesItem>.unmodifiable(series);
    });
  }

  @override
  Future<void> writeSeriesList(List<SeriesItem> series) {
    return _write((home, index) {
      index.series = List<SeriesItem>.unmodifiable(series);
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
    });
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
    });
  }

  @override
  Future<void> removeEpisode(String seriesPublicId, String episodePublicId) {
    return _write((home, index) async {
      final removed = index.episodes.remove(
        savedEpisodeKey(seriesPublicId, episodePublicId),
      );
      if (removed == null) {
        return;
      }
      for (final key in removed.pageKeys) {
        await _deletePage(home, key);
      }
      _pageBytes = null;
    });
  }

  @override
  Future<Set<String>> readableEpisodeIds(
    String seriesPublicId, {
    required String readerId,
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    final ids = await _read<Set<String>>((home, index) {
      return {
        for (final episode in index.episodes.values)
          if (episode.detail.seriesId == seriesPublicId &&
              isReadableOffline(episode, readerId: readerId, now: at))
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
    return _write((home, index) async {
      final sealed = sealOfflineBytes(
        plaintext: bytes,
        deviceKey: home.key,
        label: _pageLabel(key),
      );
      await _writeFile(File(_pagePath(home, key)), sealed);
      final known = _pageBytes;
      _pageBytes = known == null
          ? await _measurePages(home)
          : known + sealed.length;
      if (_pageBytes! > byteLimit) {
        await _evict(home, index);
        await _writeIndex(home, index);
      }
    }, persist: false);
  }

  @override
  Future<void> clear() {
    return _write((home, index) async {
      await _wipe(home);
      index
        ..series = null
        ..details.clear()
        ..episodes.clear();
      _pageBytes = 0;
    });
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
    }
    _pageBytes = total;
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
    if (present && index == null) {
      // The device key is gone, or the file came from a build that wrote
      // another shape. Either way nothing under it reads, pages included.
      await _wipe(home);
    }
    return _index = index ?? OfflineIndex();
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
