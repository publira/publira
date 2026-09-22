import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// How many series one page of the list asks for, the API's own default.
const _pageSize = 20;

/// The series the reader is in the middle of, newest activity first, each
/// opening the episode the API names to continue from.
///
/// It is the catalog's continue-reading row as a whole list, one cursor page
/// at a time. The API answers it for a session alone, so a guest is offered
/// the way to sign in instead.
class ContinueReadingList extends StatefulWidget {
  const ContinueReadingList({super.key});

  @override
  State<ContinueReadingList> createState() => _ContinueReadingListState();
}

class _ContinueReadingListState extends State<ContinueReadingList> {
  final _pager = CatalogPager<RecentSeriesItem, Null>(_nothingAsked);

  CatalogRepository? _catalog;
  String? _readerId;

  /// Reads the list again whenever the reader or the repository changes: the
  /// list is one reader's own history, and the tokens under it belong to the
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
      final page = await catalog.listRecentSeries(
        limit: _pageSize,
        token: token,
      );
      return CatalogPageRead(items: page.series, nextToken: page.nextToken);
    });
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('library-continue-signed-out'),
        message: messages.libraryContinueSignInPrompt,
        actionKey: const ValueKey('library-continue-sign-in'),
        actionLabel: messages.commonSignIn,
        onAction: () => context.pushInTab(AppRoutes.signIn),
      );
    }
    return ListenableBuilder(
      listenable: _pager,
      builder: (context, _) {
        final failure = _pager.failure;
        if (failure != null) {
          return CatalogMessage(
            key: const ValueKey('library-continue-error'),
            message: catalogFailureCopy(
              messages,
              failure,
              messages.catalogContinueFailed,
            ),
            actionKey: const ValueKey('library-continue-retry'),
            actionLabel: messages.commonRetry,
            onAction: _pager.restart,
          );
        }
        final items = _pager.items;
        if (items == null) {
          return const Center(
            key: ValueKey('library-continue-loading'),
            child: CircularProgressIndicator(),
          );
        }
        final hasFooter = _pager.hasFooter;
        if (items.isEmpty && !hasFooter) {
          return CatalogMessage(
            key: const ValueKey('library-continue-empty'),
            message: messages.libraryContinueEmpty,
          );
        }
        return ListView.separated(
          key: const ValueKey('library-continue-list'),
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: items.length + (hasFooter ? 1 : 0),
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= items.length - readAheadRows) {
              _pager.readMore();
            }
            if (index == items.length) {
              return PageFooter(
                sectionKey: 'library-continue-more',
                message: _pager.moreFailure == null
                    ? null
                    : catalogFailureCopy(
                        messages,
                        _pager.moreFailure,
                        messages.commonMoreSeriesFailed,
                      ),
                onRetry: _pager.retryMore,
              );
            }
            return _ContinueReadingRow(item: items[index]);
          },
        );
      },
    );
  }
}

class _ContinueReadingRow extends StatelessWidget {
  const _ContinueReadingRow({required this.item});

  final RecentSeriesItem item;

  @override
  Widget build(BuildContext context) {
    final series = item.series;
    final episode = item.episode;
    return ListTile(
      key: ValueKey('library-continue-${series.id}'),
      // The width a 3:4 cover can take inside the leading slot, as the
      // catalog's rows use.
      leading: SizedBox(
        width: 42,
        child: EyeCatchCover(
          kind: 'series',
          id: series.id,
          variants: series.eyeCatchVariants,
          requestHeaders: series.imageRequestHeaders,
          preferredTypes: const [eyeCatchPortrait],
          aspectRatio: 3 / 4,
        ),
      ),
      title: Text(series.title),
      subtitle: episode.title.isEmpty
          ? null
          : Text(episode.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: const Icon(Icons.chevron_right),
      onTap: () =>
          context.pushInTab(AppRoutes.episodeViewerPath(series.id, episode.id)),
    );
  }
}

/// What the list reads before anyone is signed in to read it for.
Future<CatalogPageRead<RecentSeriesItem, Null>?> _nothingAsked(
  String token,
) async => const CatalogPageRead(items: []);
