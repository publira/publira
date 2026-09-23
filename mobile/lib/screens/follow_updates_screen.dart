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

/// How many episodes one page of the list asks for, the API's own default.
const _pageSize = 20;

/// The episodes published in the series and by the authors the reader follows,
/// most recently published first, read from the same follow record the site's
/// My Page shows.
///
/// A row opens its episode, and the button beside it opens the series.
class FollowUpdatesScreen extends StatelessWidget {
  const FollowUpdatesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppMessages.of(context).followUpdatesTitle)),
      body: const SafeArea(child: _FollowUpdatesList()),
    );
  }
}

class _FollowUpdatesList extends StatefulWidget {
  const _FollowUpdatesList();

  @override
  State<_FollowUpdatesList> createState() => _FollowUpdatesListState();
}

class _FollowUpdatesListState extends State<_FollowUpdatesList> {
  final _pager = CatalogPager<FollowUpdateItem, Null>(_nothingAsked);

  CatalogRepository? _catalog;
  String? _readerId;

  /// Reads the list again whenever the reader or the repository changes: what
  /// is followed is one reader's own, and the tokens under it belong to the
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
      final page = await catalog.listFollowUpdates(
        limit: _pageSize,
        token: token,
      );
      return CatalogPageRead(items: page.updates, nextToken: page.nextToken);
    });
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  /// Reads the list again from the top, since the screen stays mounted while
  /// the reader follows something on another tab.
  Future<void> _refresh() => _pager.refresh();

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('follow-updates-signed-out'),
        message: messages.followUpdatesSignInPrompt,
        actionKey: const ValueKey('follow-updates-sign-in'),
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
            key: const ValueKey('follow-updates-error'),
            message: catalogFailureCopy(
              messages,
              failure,
              messages.followUpdatesFailed,
            ),
            actionKey: ValueKey(
              signIn ? 'follow-updates-sign-in' : 'follow-updates-retry',
            ),
            actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
            onAction: signIn
                ? () => context.pushInTab(AppRoutes.signIn)
                : _pager.restart,
          );
        }
        final updates = _pager.items;
        if (updates == null) {
          return const Center(
            key: ValueKey('follow-updates-loading'),
            child: CircularProgressIndicator(),
          );
        }
        final hasFooter = _pager.hasFooter;
        if (updates.isEmpty && !hasFooter) {
          return RefreshIndicator(
            onRefresh: _refresh,
            // Scrollable so the pull that reads the list again still starts.
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                CatalogMessage(
                  key: const ValueKey('follow-updates-empty'),
                  message: messages.followUpdatesEmpty,
                ),
              ],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            key: const ValueKey('follow-updates-list'),
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: updates.length + (hasFooter ? 1 : 0),
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              if (index >= updates.length - readAheadRows) {
                _pager.readMore();
              }
              if (index == updates.length) {
                return PageFooter(
                  sectionKey: 'follow-updates-more',
                  message: _pager.moreFailure == null
                      ? null
                      : catalogFailureCopy(
                          messages,
                          _pager.moreFailure,
                          messages.followUpdatesFailed,
                        ),
                  onRetry: _pager.retryMore,
                );
              }
              return _FollowUpdateRow(update: updates[index]);
            },
          ),
        );
      },
    );
  }
}

class _FollowUpdateRow extends StatelessWidget {
  const _FollowUpdateRow({required this.update});

  final FollowUpdateItem update;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final series = update.series;
    final episode = update.episode;
    final title = [
      '#${messages.formatInteger(episode.orderIndex)}',
      if (episode.title.isNotEmpty) episode.title,
    ].join(' ');
    return ListTile(
      key: ValueKey('follow-updates-row-${episode.id}'),
      isThreeLine: true,
      title: Text(title),
      subtitle: Text(
        [
          if (series.title.isNotEmpty) series.title,
          if (update.publishedAt case final publishedAt?)
            messages.followUpdatesPublishedAt(
              date: messages.formatDateTime(publishedAt),
            ),
        ].join('\n'),
      ),
      trailing: IconButton(
        key: ValueKey('follow-updates-series-${episode.id}'),
        tooltip: messages.followUpdatesOpenSeries,
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
Future<CatalogPageRead<FollowUpdateItem, Null>?> _nothingAsked(
  String token,
) async => const CatalogPageRead(items: []);
