import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/series_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

/// Home / catalog screen: shelves of the tenant's catalog above the whole of
/// it.
///
/// Every section reads its own page of [CatalogRepository] and owns what it
/// shows while that read is in flight and when it fails, so a section the API
/// could not answer offers its retry where it stands rather than taking the
/// screen down with it. A pull to refresh is the one gesture over all of them:
/// it reads every section again from the top, the catalog list included, which
/// drops the pages the reader had scrolled into.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  /// Pulls to refresh so far. Every section reads again whenever it changes.
  var _refreshes = 0;

  /// Completed once the catalog list has read its first page again, which is
  /// what takes the pull-to-refresh spinner away. The shelves above it are not
  /// waited for: each one puts its own skeleton up and arrives when it does.
  Completer<void>? _refreshing;

  @override
  void dispose() {
    _refreshing?.complete();
    super.dispose();
  }

  Future<void> _refresh() {
    final pending = Completer<void>();
    setState(() {
      _refreshes++;
      _refreshing = pending;
    });
    return pending.future;
  }

  void _refreshed() {
    _refreshing?.complete();
    _refreshing = null;
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Publira'),
        actions: [
          IconButton(
            key: const ValueKey('catalog-account'),
            icon: Icon(signedIn ? Icons.person : Icons.person_outline),
            tooltip: signedIn ? messages.accountTitle : messages.commonSignIn,
            onPressed: () =>
                context.push(signedIn ? AppRoutes.account : AppRoutes.signIn),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          // A catalog short enough to fit the screen still has to be draggable,
          // or the one gesture that reloads it would not start.
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: _ContinueReadingShelf(refreshes: _refreshes),
            ),
            SliverToBoxAdapter(child: _RankingShelf(refreshes: _refreshes)),
            SliverToBoxAdapter(child: _NewArrivalsShelf(refreshes: _refreshes)),
            _AllSeriesSection(refreshes: _refreshes, onLoaded: _refreshed),
          ],
        ),
      ),
    );
  }
}

/// How many offers the continue-reading row asks for. A phone shows two and a
/// half of them at once, so ten is several flicks of scrolling and one page of
/// the API's list.
const _continueReadingLimit = 10;

/// The week's chart is a top ten, which is what its heading says it is.
const _rankingLimit = 10;

/// As many new arrivals as the chart beside it holds, so the two shelves
/// scroll the same distance.
const _newArrivalsLimit = 10;

/// Width of one card on a shelf, and the shape its cover is cut to.
const _shelfCardWidth = 132.0;
const _shelfCardAspectRatio = 3 / 4;

/// The cover plus the two lines under it, which is what a card is allowed to
/// grow to before its text starts to ellipsize. Every shelf reserves it,
/// loading or loaded, so a row arriving does not move the ones below it.
const _shelfHeight = _shelfCardWidth / _shelfCardAspectRatio + 80;

/// The reader's own continue-reading row, at the top of the catalog.
///
/// A reader who is signed out has nothing here to ask for, and one in the
/// middle of nothing is shown no row: it is an offer rather than a report.
class _ContinueReadingShelf extends StatelessWidget {
  const _ContinueReadingShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    // The row is one reader's own history, so a sign-in or a sign-out asks
    // again rather than showing what the reader before them was reading.
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    return _CatalogShelf<RecentSeriesItem>(
      sectionKey: 'continue-reading',
      heading: messages.catalogContinueHeading,
      failureMessage: messages.catalogContinueFailed,
      reloadToken: '$readerId#$refreshes',
      load: (catalog) async {
        if (readerId.isEmpty) {
          return const [];
        }
        return catalog.listRecentSeries(limit: _continueReadingLimit);
      },
      cardBuilder: (context, item) => _ShelfCard(
        key: ValueKey('continue-reading-${item.series.id}'),
        series: item.series,
        subtitle: item.episode.title,
        onTap: () => context.push(
          AppRoutes.episodeViewerPath(item.series.id, item.episode.id),
        ),
      ),
    );
  }
}

/// The week's chart, in the positions the last ranking snapshot recorded.
///
/// A tenant the ranking batch has not run for yet has no chart, and is shown
/// no row rather than an empty one.
class _RankingShelf extends StatelessWidget {
  const _RankingShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return _CatalogShelf<RankedSeriesItem>(
      sectionKey: 'catalog-ranking',
      heading: messages.catalogRankingHeading,
      failureMessage: messages.catalogRankingFailed,
      reloadToken: '$refreshes',
      load: (catalog) => catalog.listRankedSeries(
        limit: _rankingLimit,
        period: RankingPeriod.weekly,
      ),
      cardBuilder: (context, item) => _ShelfCard(
        key: ValueKey('catalog-ranking-${item.series.id}'),
        series: item.series,
        subtitle: _creditLine(messages, item.series),
        rank: item.rank,
        onTap: () => context.push(AppRoutes.seriesDetailPath(item.series.id)),
      ),
    );
  }
}

/// The series the tenant published most recently.
class _NewArrivalsShelf extends StatelessWidget {
  const _NewArrivalsShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return _CatalogShelf<SeriesItem>(
      sectionKey: 'catalog-new-arrivals',
      heading: messages.catalogNewArrivalsHeading,
      failureMessage: messages.catalogNewArrivalsFailed,
      reloadToken: '$refreshes',
      load: (catalog) => catalog.listNewestSeries(limit: _newArrivalsLimit),
      cardBuilder: (context, item) => _ShelfCard(
        key: ValueKey('catalog-new-arrivals-${item.id}'),
        series: item,
        subtitle: _creditLine(messages, item),
        onTap: () => context.push(AppRoutes.seriesDetailPath(item.id)),
      ),
    );
  }
}

/// Who a series is credited to, as one line, and empty for a series credited
/// to nobody — which is what leaves the line off a card.
String _creditLine(AppMessages messages, SeriesItem series) {
  if (series.creators.isEmpty) {
    return '';
  }
  return messages.formatList([
    for (final creator in series.creators) creator.name,
  ]);
}

/// One horizontal shelf: a heading, and a row of cards under it.
///
/// An empty answer takes the heading with it. A shelf is a way into part of
/// the catalog, and a tenant with no chart or nothing in the middle of reading
/// is not a tenant with an empty chart.
class _CatalogShelf<T> extends StatefulWidget {
  const _CatalogShelf({
    required this.sectionKey,
    required this.heading,
    required this.failureMessage,
    required this.load,
    required this.cardBuilder,
    required this.reloadToken,
  });

  /// Names this section on screen, and its loading, failure, and retry states.
  final String sectionKey;

  final String heading;

  /// What the shelf says about a failure it has no closer words for. A request
  /// that could not reach the API is reported as that instead.
  final String failureMessage;

  final Future<List<T>> Function(CatalogRepository catalog) load;

  final Widget Function(BuildContext context, T item) cardBuilder;

  /// Reloads the shelf whenever it changes: it names the reader the row is
  /// answered for and the pulls to refresh behind it.
  final String reloadToken;

  @override
  State<_CatalogShelf<T>> createState() => _CatalogShelfState<T>();
}

class _CatalogShelfState<T> extends State<_CatalogShelf<T>> {
  /// What the API answered, and `null` while a read is still in flight.
  List<T>? _items;
  CatalogFailure? _failure;

  CatalogRepository? _catalog;

  /// Counts the reads this shelf has started, so an answer to one it has
  /// stopped waiting for — a retry, or a reader who signed out meanwhile —
  /// cannot land on the screen.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _load();
  }

  @override
  void didUpdateWidget(covariant _CatalogShelf<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.reloadToken != oldWidget.reloadToken) {
      _load();
    }
  }

  void _load() {
    _items = null;
    _failure = null;
    unawaited(_read(++_reads, _catalog!));
  }

  Future<void> _read(int read, CatalogRepository catalog) async {
    List<T>? items;
    CatalogFailure? failure;
    try {
      items = await widget.load(catalog);
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _items = items;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    if (failure != null) {
      return _ShelfFrame(
        heading: widget.heading,
        child: _RetryRow(
          sectionKey: widget.sectionKey,
          message: _failureCopy(messages, failure, widget.failureMessage),
          onRetry: () => setState(_load),
        ),
      );
    }
    final items = _items;
    if (items == null) {
      return _ShelfFrame(
        heading: widget.heading,
        child: _ShelfSkeleton(sectionKey: widget.sectionKey),
      );
    }
    if (items.isEmpty) {
      return const SizedBox.shrink();
    }
    // The section is named only once it is showing its cards, so a screen that
    // has it and a screen still waiting on it are told apart by the same key.
    return _ShelfFrame(
      key: ValueKey(widget.sectionKey),
      heading: widget.heading,
      child: SizedBox(
        height: _shelfHeight,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          separatorBuilder: (context, index) => const SizedBox(width: 12),
          itemBuilder: (context, index) =>
              widget.cardBuilder(context, items[index]),
        ),
      ),
    );
  }
}

/// The heading every state of a shelf stands under.
class _ShelfFrame extends StatelessWidget {
  const _ShelfFrame({super.key, required this.heading, required this.child});

  final String heading;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [_SectionHeading(heading), child],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(text, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

/// What a shelf shows while its page is still in flight: cards the size the
/// real ones will be.
class _ShelfSkeleton extends StatelessWidget {
  const _ShelfSkeleton({required this.sectionKey});

  final String sectionKey;

  /// Enough to reach the edge of a phone, which is what tells the reader the
  /// row scrolls before it holds anything.
  static const _cardCount = 3;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      key: ValueKey('$sectionKey-loading'),
      height: _shelfHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        // Nothing here is reachable, and the row under it is the one the
        // reader will scroll.
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _cardCount,
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) => SizedBox(
          width: _shelfCardWidth,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: _shelfCardAspectRatio,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _SkeletonLine(color: colors.surfaceContainerHighest, width: 108),
              const SizedBox(height: 8),
              _SkeletonLine(color: colors.surfaceContainerHighest, width: 72),
            ],
          ),
        ),
      ),
    );
  }
}

class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({required this.color, required this.width});

  final Color color;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// What a section shows in place of its contents when the API could not
/// answer it: what went wrong, and the offer to ask again.
class _RetryRow extends StatelessWidget {
  const _RetryRow({
    required this.sectionKey,
    required this.message,
    required this.onRetry,
  });

  final String sectionKey;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: ValueKey('$sectionKey-error'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 8),
          TextButton(
            key: ValueKey('$sectionKey-retry'),
            onPressed: onRetry,
            child: Text(AppMessages.of(context).commonRetry),
          ),
        ],
      ),
    );
  }
}

/// One card of a shelf: the cover of a series, its title, and one line under
/// it.
class _ShelfCard extends StatelessWidget {
  const _ShelfCard({
    super.key,
    required this.series,
    required this.subtitle,
    required this.onTap,
    this.rank,
  });

  final SeriesItem series;

  /// The second line: the episode a reader would continue from, or who the
  /// series is credited to. Empty leaves the line off.
  final String subtitle;

  final VoidCallback onTap;

  /// The position a ranking snapshot gave the series, drawn over its cover.
  /// `null` on a shelf that is not a chart.
  final int? rank;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rank = this.rank;
    return SizedBox(
      width: _shelfCardWidth,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                SeriesCover(
                  series: series,
                  preferredTypes: const [eyeCatchPortrait],
                  aspectRatio: _shelfCardAspectRatio,
                ),
                if (rank != null) _RankBadge(rank),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: Text(
                series.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            if (subtitle.isNotEmpty)
              Flexible(
                child: Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The position a chart gave a series, in the corner of its cover.
class _RankBadge extends StatelessWidget {
  const _RankBadge(this.rank);

  final int rank;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Positioned(
      top: 4,
      left: 4,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.primary,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          child: Text(
            AppMessages.of(context).formatInteger(rank),
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onPrimary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ),
    );
  }
}

/// How many rows before the end of the list the page under it is asked for.
/// A phone shows about eight tiles at once, so a page started five rows early
/// is usually on screen before the reader reaches the row that asked for it.
const _readAheadRows = 5;

/// The whole catalog, by title, under the shelves that are ways into it.
///
/// It is read one page at a time: the first arrives with the screen, and every
/// page under it is asked for as the reader nears the end of what is already
/// there. A page that fails is reported in the footer under the rows that did
/// arrive, because those rows are what the reader is in the middle of.
class _AllSeriesSection extends StatefulWidget {
  const _AllSeriesSection({required this.refreshes, required this.onLoaded});

  /// Pulls to refresh so far. A change reads the catalog from its first page
  /// again, dropping the pages the reader had scrolled into.
  final int refreshes;

  /// Called whenever a first-page read finishes, whether it arrived or failed,
  /// which is what lets the pull to refresh put its spinner away.
  final VoidCallback onLoaded;

  @override
  State<_AllSeriesSection> createState() => _AllSeriesSectionState();
}

class _AllSeriesSectionState extends State<_AllSeriesSection> {
  /// Every page read so far as one list, and `null` while the first is still
  /// in flight.
  List<SeriesItem>? _series;

  /// What the API calls the page under [_series]. Empty at the end of the
  /// catalog, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole section, and a later page's,
  /// which is the footer under the rows already on screen.
  CatalogFailure? _failure;
  CatalogFailure? _moreFailure;

  /// Whether a page is in flight. The screen is not built from it — the footer
  /// stands for as long as there is a page left to read — so it is set without
  /// [setState], which is what lets the list ask for a page while it builds.
  var _reading = false;

  CatalogRepository? _catalog;

  /// Counts the reads this section has started, so an answer to one it has
  /// stopped waiting for — a refresh, or a repository swapped under it —
  /// cannot land on the screen.
  var _reads = 0;

  /// Reads again when the repository changes, the way every shelf above does:
  /// a screen keeping the previous one's list under the shelves of the new one
  /// would be showing two catalogs at once.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _loadFirstPage();
  }

  @override
  void didUpdateWidget(covariant _AllSeriesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshes != oldWidget.refreshes) {
      _loadFirstPage();
    }
  }

  void _loadFirstPage() {
    _series = null;
    _nextToken = '';
    _failure = null;
    _moreFailure = null;
    _reading = true;
    unawaited(_read(++_reads, _catalog!, ''));
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the catalog ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    unawaited(_read(++_reads, _catalog!, _nextToken));
  }

  /// Reads the page [token] names and puts it under what is already there.
  Future<void> _read(int read, CatalogRepository catalog, String token) async {
    final isFirstPage = token.isEmpty;
    SeriesPage? page;
    CatalogFailure? failure;
    try {
      page = await catalog.listSeries(token: token);
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _reading = false;
      if (page == null) {
        if (isFirstPage) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _series = [if (!isFirstPage) ...?_series, ...page.series];
      _nextToken = page.nextToken;
    });
    if (isFirstPage) {
      widget.onLoaded();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: _SectionHeading(messages.catalogAllSeriesHeading),
        ),
        _list(messages),
      ],
    );
  }

  Widget _list(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      return SliverToBoxAdapter(
        child: _CatalogMessage(
          key: const ValueKey('catalog-error'),
          message: _failureCopy(messages, failure, messages.catalogLoadFailed),
          actionLabel: messages.commonRetry,
          onAction: () => setState(_loadFirstPage),
        ),
      );
    }
    final series = _series;
    if (series == null) {
      return const SliverToBoxAdapter(
        child: Padding(
          key: ValueKey('catalog-loading'),
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    // The footer is the page under the list: a spinner while there is one left
    // to read, and what went wrong when the last attempt at it failed.
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    if (series.isEmpty && !hasFooter) {
      return SliverToBoxAdapter(
        child: _CatalogMessage(
          key: const ValueKey('catalog-empty'),
          message: messages.catalogEmpty,
        ),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      sliver: SliverList.separated(
        itemCount: series.length + (hasFooter ? 1 : 0),
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index >= series.length - _readAheadRows) {
            _readMore();
          }
          if (index == series.length) {
            return _CatalogPageFooter(
              message: _moreFailure == null
                  ? null
                  : _failureCopy(
                      messages,
                      _moreFailure,
                      messages.catalogLoadFailed,
                    ),
              onRetry: () {
                setState(() {
                  _moreFailure = null;
                });
                _readMore();
              },
            );
          }
          return _SeriesTile(series: series[index]);
        },
      ),
    );
  }
}

/// The page under the catalog list, at the bottom of it: a spinner while that
/// page is being read, and what went wrong when it could not be.
class _CatalogPageFooter extends StatelessWidget {
  const _CatalogPageFooter({required this.message, required this.onRetry});

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = this.message;
    if (message == null) {
      return const Padding(
        key: ValueKey('catalog-more-loading'),
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: _RetryRow(
        sectionKey: 'catalog-more',
        message: message,
        onRetry: onRetry,
      ),
    );
  }
}

/// One row of the whole-catalog list.
class _SeriesTile extends StatelessWidget {
  const _SeriesTile({required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final credits = _creditLine(messages, series);
    final classification = _tileClassification(messages, series);
    return ListTile(
      key: ValueKey('series-tile-${series.id}'),
      // 42 is the widest a 3:4 box can be and still stand inside the 56 pixels
      // ListTile allows its leading widget; a taller one is squeezed back to
      // this width anyway.
      leading: SizedBox(
        width: 42,
        child: SeriesCover(
          series: series,
          preferredTypes: const [eyeCatchPortrait],
          aspectRatio: 3 / 4,
        ),
      ),
      title: Text(series.title),
      subtitle:
          credits.isEmpty &&
              classification.isEmpty &&
              series.description.isEmpty
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (credits.isNotEmpty)
                  Text(credits, maxLines: 1, overflow: TextOverflow.ellipsis),
                if (classification.isNotEmpty)
                  Text(
                    key: ValueKey('series-tile-classification-${series.id}'),
                    classification,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (series.description.isNotEmpty)
                  Text(
                    series.description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
      trailing: series.labelName.isEmpty ? null : Text(series.labelName),
      onTap: () => context.push(AppRoutes.seriesDetailPath(series.id)),
    );
  }
}

/// Status and the first genre, which is what a catalog tile has room for.
/// Empty when the series carries neither, which leaves the line off.
String _tileClassification(AppMessages messages, SeriesItem series) {
  final parts = <String>[
    if (series.status != null) messages.seriesStatusLabel(series.status!),
    if (series.genres.isNotEmpty) series.genres.first.name,
  ];
  return parts.join(' · ');
}

/// What a section says about a failure, in the words closest to it.
///
/// A request that could not reach the API and a device holding nothing saved
/// are the same two answers wherever they happen, so only the rest is left to
/// the section: [fallback] is what it calls a failure of its own.
String _failureCopy(AppMessages messages, Object? error, String fallback) {
  if (error is! CatalogFailure) {
    return fallback;
  }
  return switch (error.kind) {
    CatalogFailureKind.network => messages.errorsRpcUnavailable,
    CatalogFailureKind.notSaved ||
    CatalogFailureKind.saveExpired => messages.catalogOfflineNotSaved,
    CatalogFailureKind.unexpected => fallback,
  };
}

class _CatalogMessage extends StatelessWidget {
  const _CatalogMessage({
    super.key,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('catalog-retry'),
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
