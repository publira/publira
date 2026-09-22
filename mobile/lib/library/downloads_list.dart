import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/offline/episode_downloader.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';

/// What the device keeps for reading offline, as the library shows it: the
/// bytes it spends against the cap, the saved episodes by series, and the way
/// to delete them.
///
/// Only episodes the reader holding the device could open are listed. A body
/// saved for another account names what that account bought, so it counts
/// towards the bytes shown and goes with "Clear all", and is not listed.
class DownloadsList extends StatefulWidget {
  const DownloadsList({super.key});

  @override
  State<DownloadsList> createState() => _DownloadsListState();
}

class _DownloadsListState extends State<DownloadsList> {
  OfflineLibrary? _library;
  StreamSubscription<void>? _changes;

  /// The saves running when this screen last looked. A save that finishes
  /// while the screen is open has grown the bytes it shows, and the library
  /// announces an episode once it is whole rather than each page on the way,
  /// which a save that fails partway never reaches.
  EpisodeDownloader? _downloader;
  var _saving = false;
  OfflineStorage? _storage;
  var _readerId = '';

  /// Counts the reads this screen has started, so a slow one cannot land over
  /// the answer to a later one.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final library = OfflineScope.maybeOf(context);
    final downloader = OfflineScope.downloaderOf(context);
    if (downloader != _downloader) {
      _downloader?.removeListener(_onDownloaderChanged);
      _downloader = downloader;
      // A listener is not told what it missed, and the screen is opened from
      // the row that started the save, so what is running now is read here.
      _saving = downloader?.isSaving ?? false;
      downloader?.addListener(_onDownloaderChanged);
    }
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    if (library == _library && readerId == _readerId && _storage != null) {
      return;
    }
    _readerId = readerId;
    if (library != _library) {
      unawaited(_changes?.cancel());
      _library = library;
      _changes = library?.changes.listen((_) => _read());
    }
    _read();
  }

  @override
  void dispose() {
    _downloader?.removeListener(_onDownloaderChanged);
    unawaited(_changes?.cancel());
    super.dispose();
  }

  /// Reads the bytes again once the saves that were running have finished,
  /// rather than on every page they fetch, which would measure the directory
  /// once per page.
  void _onDownloaderChanged() {
    final saving = _downloader?.isSaving ?? false;
    if (_saving && !saving) {
      _read();
    }
    _saving = saving;
  }

  void _read() {
    final library = _library;
    final read = ++_reads;
    if (library == null) {
      _storage = OfflineStorage.empty;
      return;
    }
    unawaited(
      library.readStorage().then((storage) {
        if (mounted && read == _reads) {
          setState(() => _storage = storage);
        }
      }),
    );
  }

  Future<void> _delete(SavedEpisode episode) async {
    final library = _library;
    if (library == null) {
      return;
    }
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    await library.removeEpisode(
      episode.detail.seriesId,
      episode.detail.episode.id,
    );
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          messages.downloadsDeleted(title: episode.detail.episode.title),
        ),
      ),
    );
  }

  Future<void> _clear() async {
    final library = _library;
    if (library == null) {
      return;
    }
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('downloads-clear-dialog'),
        title: Text(messages.downloadsClearConfirmTitle),
        content: Text(messages.downloadsClearConfirmDescription),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(messages.commonCancel),
          ),
          FilledButton(
            key: const ValueKey('downloads-clear-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(messages.downloadsClearConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    await library.clear();
    messenger.showSnackBar(SnackBar(content: Text(messages.downloadsCleared)));
  }

  @override
  Widget build(BuildContext context) {
    final storage = _storage;
    if (storage == null) {
      return const Center(
        key: ValueKey('downloads-loading'),
        child: CircularProgressIndicator(),
      );
    }
    return _SavedEpisodes(
      storage: storage,
      readerId: _readerId,
      onDelete: (episode) => unawaited(_delete(episode)),
      onClear: () => unawaited(_clear()),
    );
  }
}

class _SavedEpisodes extends StatelessWidget {
  const _SavedEpisodes({
    required this.storage,
    required this.readerId,
    required this.onDelete,
    required this.onClear,
  });

  final OfflineStorage storage;
  final String readerId;
  final ValueChanged<SavedEpisode> onDelete;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    // Episodes arrive most recently confirmed first, so a series takes the
    // place of its most recent one.
    final bySeries = <String, List<StoredEpisode>>{};
    for (final stored in storage.episodes) {
      final owner = stored.episode.ownerId;
      if (owner.isNotEmpty && owner != readerId) {
        continue;
      }
      (bySeries[stored.episode.detail.seriesId] ??= []).add(stored);
    }
    final now = DateTime.now();

    return ListView(
      key: const ValueKey('downloads-list'),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      key: const ValueKey('downloads-usage'),
                      messages.downloadsUsage(
                        used: messages.formatByteSize(storage.bytes),
                        limit: messages.formatByteSize(storage.byteLimit),
                      ),
                      style: theme.textTheme.bodyLarge,
                    ),
                  ),
                  if (storage.bytes > 0 || storage.episodes.isNotEmpty)
                    TextButton(
                      key: const ValueKey('downloads-clear'),
                      onPressed: onClear,
                      child: Text(messages.downloadsClear),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(
                value: storage.byteLimit <= 0
                    ? 0
                    : (storage.bytes / storage.byteLimit).clamp(0, 1),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        if (bySeries.isEmpty)
          Padding(
            key: const ValueKey('downloads-empty'),
            padding: const EdgeInsets.all(24),
            child: Text(messages.downloadsEmpty, textAlign: TextAlign.center),
          )
        else
          for (final episodes in bySeries.values) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                key: ValueKey(
                  'downloads-series-${episodes.first.episode.detail.seriesId}',
                ),
                episodes.first.episode.detail.seriesTitle,
                style: theme.textTheme.titleMedium,
              ),
            ),
            for (final stored in episodes)
              _DownloadTile(stored: stored, now: now, onDelete: onDelete),
          ],
      ],
    );
  }
}

class _DownloadTile extends StatelessWidget {
  const _DownloadTile({
    required this.stored,
    required this.now,
    required this.onDelete,
  });

  final StoredEpisode stored;
  final DateTime now;
  final ValueChanged<SavedEpisode> onDelete;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final episode = stored.episode;
    final detail = episode.detail;
    final until = offlineReadableUntil(episode);
    return ListTile(
      key: ValueKey('downloads-episode-${detail.episode.id}'),
      title: Text(detail.episode.title),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            messages.downloadsSavedAt(
              date: messages.formatDateTime(episode.checkedAt),
              size: messages.formatByteSize(stored.bytes),
            ),
          ),
          // The size alone does not say an episode stops partway, and its
          // row on the series screen is where the rest is fetched.
          if (!stored.isWhole)
            Text(
              key: ValueKey('downloads-partial-${detail.episode.id}'),
              messages.downloadsPartial(
                saved: messages.formatInteger(stored.savedPages),
                total: messages.formatInteger(stored.pageCount),
              ),
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
          if (until != null)
            Text(
              key: ValueKey('downloads-expiry-${detail.episode.id}'),
              until.isAfter(now)
                  ? messages.downloadsReadableUntil(
                      date: messages.formatDateTime(until),
                    )
                  : messages.downloadsExpired(
                      date: messages.formatDateTime(until),
                    ),
              style: until.isAfter(now)
                  ? null
                  : TextStyle(color: theme.colorScheme.error),
            ),
        ],
      ),
      trailing: IconButton(
        key: ValueKey('downloads-delete-${detail.episode.id}'),
        icon: const Icon(Icons.delete_outline),
        tooltip: messages.downloadsDeleteAria(title: detail.episode.title),
        onPressed: () => onDelete(episode),
      ),
      onTap: () => context.pushInTab(
        AppRoutes.episodeViewerPath(detail.seriesId, detail.episode.id),
      ),
    );
  }
}
