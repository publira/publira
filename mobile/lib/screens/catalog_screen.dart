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
/// screen down with it.
class CatalogScreen extends StatelessWidget {
  const CatalogScreen({super.key});

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
      body: const CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _ContinueReadingShelf()),
          SliverToBoxAdapter(child: _RankingShelf()),
          SliverToBoxAdapter(child: _NewArrivalsShelf()),
          _AllSeriesSection(),
        ],
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
  const _ContinueReadingShelf();

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
      reloadToken: readerId,
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
  const _RankingShelf();

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return _CatalogShelf<RankedSeriesItem>(
      sectionKey: 'catalog-ranking',
      heading: messages.catalogRankingHeading,
      failureMessage: messages.catalogRankingFailed,
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
  const _NewArrivalsShelf();

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return _CatalogShelf<SeriesItem>(
      sectionKey: 'catalog-new-arrivals',
      heading: messages.catalogNewArrivalsHeading,
      failureMessage: messages.catalogNewArrivalsFailed,
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
    this.reloadToken = '',
  });

  /// Names this section on screen, and its loading, failure, and retry states.
  final String sectionKey;

  final String heading;

  /// What the shelf says about a failure it has no closer words for. A request
  /// that could not reach the API is reported as that instead.
  final String failureMessage;

  final Future<List<T>> Function(CatalogRepository catalog) load;

  final Widget Function(BuildContext context, T item) cardBuilder;

  /// Reloads the shelf whenever it changes. Empty for a shelf that answers
  /// everybody the same.
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
        child: _ShelfFailure(
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

/// What a shelf shows instead of its cards when the API could not answer it.
class _ShelfFailure extends StatelessWidget {
  const _ShelfFailure({
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

/// The whole catalog, by title, under the shelves that are ways into it.
class _AllSeriesSection extends StatefulWidget {
  const _AllSeriesSection();

  @override
  State<_AllSeriesSection> createState() => _AllSeriesSectionState();
}

class _AllSeriesSectionState extends State<_AllSeriesSection> {
  late Future<List<SeriesItem>> _future;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = CatalogScope.of(context).listSeries();
  }

  void _reload() {
    setState(() {
      _future = CatalogScope.of(context).listSeries();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: _SectionHeading(messages.catalogAllSeriesHeading),
        ),
        FutureBuilder<List<SeriesItem>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const SliverToBoxAdapter(
                child: Padding(
                  key: ValueKey('catalog-loading'),
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              );
            }
            if (snapshot.hasError) {
              return SliverToBoxAdapter(
                child: _CatalogMessage(
                  key: const ValueKey('catalog-error'),
                  message: _failureCopy(
                    messages,
                    snapshot.error,
                    messages.catalogLoadFailed,
                  ),
                  actionLabel: messages.commonRetry,
                  onAction: _reload,
                ),
              );
            }
            final series = snapshot.data ?? const <SeriesItem>[];
            if (series.isEmpty) {
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
                itemCount: series.length,
                separatorBuilder: (context, index) => const Divider(height: 1),
                itemBuilder: (context, index) =>
                    _SeriesTile(series: series[index]),
              ),
            );
          },
        ),
      ],
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
      subtitle: credits.isEmpty && series.description.isEmpty
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (credits.isNotEmpty)
                  Text(credits, maxLines: 1, overflow: TextOverflow.ellipsis),
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
