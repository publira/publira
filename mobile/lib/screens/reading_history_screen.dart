import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// How many episodes one page of the history asks for, the API's own default.
const _pageSize = 20;

/// Every episode the reader has finished, most recently finished first, read
/// from the API, so an episode finished on the site or on another device is
/// here too.
///
/// A row opens its episode, and the button beside it opens the series.
class ReadingHistoryScreen extends StatelessWidget {
  const ReadingHistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppMessages.of(context).readingHistoryTitle)),
      body: const SafeArea(child: _ReadingHistoryList()),
    );
  }
}

class _ReadingHistoryList extends StatefulWidget {
  const _ReadingHistoryList();

  @override
  State<_ReadingHistoryList> createState() => _ReadingHistoryListState();
}

class _ReadingHistoryListState extends State<_ReadingHistoryList> {
  final _pager = CatalogPager<EpisodeReadItem, Null>(_nothingAsked);

  CatalogRepository? _catalog;
  String? _readerId;

  /// Reads the list again whenever the reader or the repository changes: the
  /// history is one reader's own, and the tokens under it belong to the
  /// repository that answered them.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    if (identical(catalog, _catalog) && readerId == _readerId) {
      return;
    }
    _catalog = catalog;
    _readerId = readerId;
    if (readerId.isEmpty) {
      _pager.clear();
      return;
    }
    _pager.restart((token) async {
      final page = await catalog.listEpisodeReads(
        limit: _pageSize,
        token: token,
      );
      return CatalogPageRead(items: page.reads, nextToken: page.nextToken);
    });
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  /// Reads the history again from the top, since the screen stays mounted
  /// while the reader finishes an episode on another tab.
  Future<void> _refresh() => _pager.refresh();

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('reading-history-signed-out'),
        message: messages.readingHistorySignInPrompt,
        actionKey: const ValueKey('reading-history-sign-in'),
        actionLabel: messages.commonSignIn,
        onAction: () => context.pushInTab(AppRoutes.signIn),
      );
    }
    return ListenableBuilder(
      listenable: _pager,
      builder: (context, _) {
        // A session the API refuses is refused for every page, so it takes
        // the whole screen, where the way out is to sign in again.
        final failure =
            _pager.failure ??
            (_pager.moreFailure?.kind == CatalogFailureKind.sessionExpired
                ? _pager.moreFailure
                : null);
        if (failure != null) {
          final signIn = failure.kind == CatalogFailureKind.sessionExpired;
          return CatalogMessage(
            key: const ValueKey('reading-history-error'),
            message: catalogFailureCopy(
              messages,
              failure,
              messages.readingHistoryFailed,
            ),
            actionKey: ValueKey(
              signIn ? 'reading-history-sign-in' : 'reading-history-retry',
            ),
            actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
            onAction: signIn
                ? () => context.pushInTab(AppRoutes.signIn)
                : _pager.restart,
          );
        }
        final reads = _pager.items;
        if (reads == null) {
          return const Center(
            key: ValueKey('reading-history-loading'),
            child: CircularProgressIndicator(),
          );
        }
        final hasFooter = _pager.hasFooter;
        if (reads.isEmpty && !hasFooter) {
          return RefreshIndicator(
            onRefresh: _refresh,
            // Scrollable so the pull that reads the list again still starts.
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                CatalogMessage(
                  key: const ValueKey('reading-history-empty'),
                  message: messages.readingHistoryEmpty,
                ),
              ],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            key: const ValueKey('reading-history-list'),
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: reads.length + (hasFooter ? 1 : 0),
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              if (index >= reads.length - readAheadRows) {
                _pager.readMore();
              }
              if (index == reads.length) {
                return PageFooter(
                  sectionKey: 'reading-history-more',
                  message: _pager.moreFailure == null
                      ? null
                      : catalogFailureCopy(
                          messages,
                          _pager.moreFailure,
                          messages.readingHistoryFailed,
                        ),
                  onRetry: _pager.retryMore,
                );
              }
              return _ReadingHistoryRow(read: reads[index]);
            },
          ),
        );
      },
    );
  }
}

class _ReadingHistoryRow extends StatelessWidget {
  const _ReadingHistoryRow({required this.read});

  final EpisodeReadItem read;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final series = read.series;
    final episode = read.episode;
    final title = [
      '#${messages.formatInteger(episode.orderIndex)}',
      if (episode.title.isNotEmpty) episode.title,
    ].join(' ');
    return ListTile(
      key: ValueKey('reading-history-row-${episode.id}'),
      isThreeLine: true,
      title: Text(title),
      subtitle: Text(
        [
          if (series.title.isNotEmpty) series.title,
          if (read.readAt case final readAt?)
            messages.readingHistoryFinishedAt(
              date: messages.formatDateTime(readAt),
            ),
        ].join('\n'),
      ),
      trailing: IconButton(
        key: ValueKey('reading-history-series-${episode.id}'),
        tooltip: messages.readingHistoryOpenSeries,
        icon: const Icon(Icons.library_books_outlined),
        onPressed: () =>
            context.pushInTab(AppRoutes.seriesDetailPath(series.id)),
      ),
      onTap: () =>
          context.pushInTab(AppRoutes.episodeViewerPath(series.id, episode.id)),
    );
  }
}

/// What the list reads before anyone is signed in to read it for.
Future<CatalogPageRead<EpisodeReadItem, Null>?> _nothingAsked(
  String token,
) async => const CatalogPageRead(items: []);
