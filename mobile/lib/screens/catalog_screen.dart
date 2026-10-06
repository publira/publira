import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/announcements/pinned_announcement_banner.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_shelf.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/creator_tile.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/catalog/genre_chip.dart';
import 'package:publira/catalog/series_tile.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

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
    unawaited(AnnouncementScope.maybeOf(context)?.refreshPinned());
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
    return Scaffold(
      appBar: AppBar(
        title: const _CatalogTitle(),
        actions: [
          // The announcements are the tenant's word to everyone, so the way
          // to them stands on the screen every reader opens on.
          if (AnnouncementScope.maybeOf(context) != null)
            AutospacedTooltip(
              message: messages.announcementsTitle,
              child: IconButton(
                key: const ValueKey('catalog-announcements'),
                icon: const Icon(Icons.campaign_outlined),
                onPressed: () => context.pushInTab(AppRoutes.announcements),
              ),
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
            const SliverToBoxAdapter(child: PinnedAnnouncementBanner()),
            SliverToBoxAdapter(
              child: _ContinueReadingShelf(refreshes: _refreshes),
            ),
            SliverToBoxAdapter(child: _GenresShelf(refreshes: _refreshes)),
            SliverToBoxAdapter(child: _PopularShelf(refreshes: _refreshes)),
            SliverToBoxAdapter(child: _NewArrivalsShelf(refreshes: _refreshes)),
            SliverToBoxAdapter(child: _LabelsShelf(refreshes: _refreshes)),
            SliverToBoxAdapter(child: _CreatorsShelf(refreshes: _refreshes)),
            _AllSeriesSection(refreshes: _refreshes, onLoaded: _refreshed),
          ],
        ),
      ),
    );
  }
}

/// The tenant's logo, or its name while it has no logo or the logo cannot be
/// drawn.
class _CatalogTitle extends StatelessWidget {
  const _CatalogTitle();

  static const _logoHeight = 32.0;

  @override
  Widget build(BuildContext context) {
    final tenant = TenantBrandScope.maybeOf(context);
    final brand = tenant?.brand;
    final name = AutospacedText(brand?.name ?? '');
    final logo = brand?.logo;
    if (logo == null) {
      return name;
    }
    return Image.network(
      logo.url.toString(),
      key: const ValueKey('catalog-logo'),
      headers: tenant?.logoRequestHeaders,
      height: _logoHeight,
      fit: BoxFit.contain,
      alignment: AlignmentDirectional.centerStart,
      semanticLabel: brand?.name,
      // The name stands in until the logo arrives, and for good when it
      // cannot, which is the case on a launch without a network.
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) =>
          frame == null ? name : child,
      errorBuilder: (context, error, stackTrace) => name,
    );
  }
}

/// How many offers the continue-reading row asks for. A phone shows two and a
/// half of them at once, so ten is several flicks of scrolling and one page of
/// the API's list.
const _continueReadingLimit = 10;

/// The week's chart is a top ten, which is what its heading says it is, and
/// the order standing in for it on a tenant with no chart is as long.
const _rankingLimit = 10;

/// As many new arrivals as the chart beside it holds, so the two shelves
/// scroll the same distance.
const _newArrivalsLimit = 10;

/// As many labels and authors as the chart holds series, so every shelf
/// scrolls the same distance.
const _directoryShelfLimit = 10;

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
    return CatalogShelf<RecentSeriesItem>(
      sectionKey: 'continue-reading',
      heading: messages.catalogContinueHeading,
      failureMessage: messages.catalogContinueFailed,
      reloadToken: '$readerId#$refreshes',
      load: (catalog) async {
        if (readerId.isEmpty) {
          return const [];
        }
        final page = await catalog.listRecentSeries(
          limit: _continueReadingLimit,
        );
        return page.series;
      },
      cardBuilder: (context, item) => SeriesShelfCard(
        key: ValueKey('continue-reading-${item.series.id}'),
        series: item.series,
        subtitle: item.episode.title.isEmpty
            ? null
            : AutospacedText(item.episode.title),
        onTap: () => context.pushInTab(
          AppRoutes.episodeViewerPath(item.series.id, item.episode.id),
        ),
      ),
    );
  }
}

/// One card of the popularity shelf: a series, and the position the week's
/// chart gave it, or `null` while the shelf stands in for a chart.
typedef _PopularCard = ({SeriesItem series, int? rank});

/// The list the popularity shelf stands in with when the tenant has no chart,
/// named on a failed read of it so the failure is reported as that list's.
const _recommendations = #recommendations;

/// The top of the week's all-ages chart, in the positions the last ranking
/// snapshot recorded, and the way to the whole of it. The app offers no rated
/// chart, so this is the only one it shows.
///
/// A tenant the ranking batch has not run for yet has no chart, and is shown
/// the head of the order recommended to the reader in front of it instead, as
/// the storefront's popularity module is, so a new tenant's catalog is not
/// missing the row its readers look to for what to read. The heading and the
/// way out follow whichever of the two the shelf shows: a chart is headed as
/// the week's top ten and leads to the ranking, and the order standing in for
/// one is headed as a recommendation and leads to the whole of that order.
class _PopularShelf extends StatelessWidget {
  const _PopularShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    // The order standing in for a chart is the reader's own, so a sign-in or
    // a sign-out asks again, as the continue-reading row does.
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    // The whole of the chart the shelf is the top of, rather than the daily
    // one the ranking screen opens on by itself.
    final rankingAll = TextButton(
      key: const ValueKey('catalog-ranking-all'),
      onPressed: () => context.pushInTab(
        AppRoutes.rankingPath(period: RankingPeriod.weekly),
      ),
      child: AutospacedText(messages.catalogViewAll),
    );
    return CatalogShelf<_PopularCard>(
      sectionKey: 'catalog-ranking',
      heading: messages.catalogRankingHeading,
      failureMessage: messages.catalogRankingFailed,
      reloadToken: '$readerId#$refreshes',
      action: rankingAll,
      frameFor: (cards) => cards.first.rank != null
          ? (heading: messages.catalogRankingHeading, action: rankingAll)
          : (
              heading: messages.recommendedTitle,
              action: TextButton(
                key: const ValueKey('catalog-recommended-all'),
                onPressed: () => context.pushInTab(AppRoutes.recommendedPath),
                child: AutospacedText(messages.catalogViewAll),
              ),
            ),
      // A failed read of the chart is the chart's, under its heading; a failed
      // read of what stands in for it is reported as a recommendation, since
      // the chart has already answered that there is none.
      failureFrameFor: (list) => (
        heading: messages.recommendedTitle,
        failureMessage: messages.recommendedLoadFailed,
      ),
      load: (catalog) async {
        final chart = await catalog.listRankedSeries(
          limit: _rankingLimit,
          period: RankingPeriod.weekly,
          ageRating: SeriesAgeRating.all,
        );
        if (chart.rankedSeries.isNotEmpty) {
          return [
            for (final item in chart.rankedSeries)
              (series: item.series, rank: item.rank),
          ];
        }
        final SeriesPage recommended;
        try {
          recommended = readerId.isEmpty
              ? await catalog.listRecommendedSeries(limit: _rankingLimit)
              : await catalog.listMyRecommendedSeries(limit: _rankingLimit);
        } on CatalogFailure catch (error) {
          throw ShelfReadFailure(_recommendations, error);
        }
        return [
          for (final series in recommended.series) (series: series, rank: null),
        ];
      },
      cardBuilder: (context, card) => SeriesShelfCard(
        key: ValueKey(
          card.rank == null
              ? 'catalog-recommended-${card.series.id}'
              : 'catalog-ranking-${card.series.id}',
        ),
        series: card.series,
        subtitle: card.series.creators.isEmpty
            ? null
            : CreatorCredits(credits: card.series.creators),
        rank: card.rank,
        onTap: () =>
            context.pushInTab(AppRoutes.seriesDetailPath(card.series.id)),
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
    return CatalogShelf<SeriesItem>(
      sectionKey: 'catalog-new-arrivals',
      heading: messages.catalogNewArrivalsHeading,
      failureMessage: messages.catalogNewArrivalsFailed,
      reloadToken: '$refreshes',
      load: (catalog) => catalog.listNewestSeries(limit: _newArrivalsLimit),
      cardBuilder: (context, item) => SeriesShelfCard(
        key: ValueKey('catalog-new-arrivals-${item.id}'),
        series: item,
        subtitle: item.creators.isEmpty
            ? null
            : CreatorCredits(credits: item.creators),
        onTap: () => context.pushInTab(AppRoutes.seriesDetailPath(item.id)),
      ),
    );
  }
}

/// The labels registered most recently, and the way to every one of them.
///
/// A tenant with no label is shown no row, heading included, for the reason
/// the genre row is not.
class _LabelsShelf extends StatelessWidget {
  const _LabelsShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return CatalogShelf<PublishedLabel>(
      sectionKey: 'catalog-labels',
      heading: messages.catalogLabelsHeading,
      failureMessage: messages.catalogLabelsFailed,
      reloadToken: '$refreshes',
      rowHeight: _labelShelfHeight,
      skeleton: const _NameShelfSkeleton(
        sectionKey: 'catalog-labels',
        height: _labelShelfHeight,
        shape: BoxShape.rectangle,
      ),
      action: TextButton(
        key: const ValueKey('catalog-labels-all'),
        onPressed: () => context.pushInTab(AppRoutes.labelsPath),
        child: AutospacedText(messages.catalogViewAll),
      ),
      load: (catalog) async =>
          (await catalog.listLabels(limit: _directoryShelfLimit)).labels,
      cardBuilder: (context, label) => _NameCard(
        key: ValueKey('catalog-labels-${label.id}'),
        artwork: EyeCatchCover(
          kind: 'label',
          id: label.id,
          variants: label.eyeCatchVariants,
          requestHeaders: label.imageRequestHeaders,
          preferredTypes: const [eyeCatchSquare],
          aspectRatio: 1,
        ),
        name: label.name,
        onTap: () => context.pushInTab(AppRoutes.labelDetailPath(label.id)),
      ),
    );
  }
}

/// The first authors by name, and the way to every one of them.
///
/// A tenant that credits no author on a published series is shown no row,
/// heading included, for the reason the genre row is not.
class _CreatorsShelf extends StatelessWidget {
  const _CreatorsShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return CatalogShelf<PublishedCreator>(
      sectionKey: 'catalog-creators',
      heading: messages.catalogCreatorsHeading,
      failureMessage: messages.catalogCreatorsFailed,
      reloadToken: '$refreshes',
      rowHeight: _creatorShelfHeight,
      skeleton: const _NameShelfSkeleton(
        sectionKey: 'catalog-creators',
        height: _creatorShelfHeight,
        shape: BoxShape.circle,
      ),
      action: TextButton(
        key: const ValueKey('catalog-creators-all'),
        onPressed: () => context.pushInTab(AppRoutes.creatorsPath),
        child: AutospacedText(messages.catalogViewAll),
      ),
      load: (catalog) async =>
          (await catalog.listCreators(limit: _directoryShelfLimit)).creators,
      cardBuilder: (context, creator) => _NameCard(
        key: ValueKey('catalog-creators-${creator.id}'),
        artwork: CreatorPortrait(
          creator: creator,
          radius: _nameArtworkSize / 2,
        ),
        name: creator.name,
        subtitle: messages.commonSeriesCount(
          count: messages.formatInteger(creator.seriesCount),
        ),
        onTap: () => context.pushInTab(AppRoutes.creatorDetailPath(creator.id)),
      ),
    );
  }
}

/// Width of one card on the label and the author shelves: wide enough for an
/// author's count to stand on one line, and narrow enough that a phone shows
/// the edge of a fourth card, which tells the reader the row scrolls.
const _nameCardWidth = 112.0;

/// The width and the height of the artwork at the top of such a card.
const _nameArtworkSize = 96.0;

/// The artwork plus the lines under it — a name of up to two lines, and the
/// author's count under that — reserved for the reason a cover shelf's own
/// height is.
const _labelShelfHeight = _nameArtworkSize + 56;
const _creatorShelfHeight = _nameArtworkSize + 80;

/// One card of the label or the author shelf: the artwork, the name under it,
/// and one line under that.
class _NameCard extends StatelessWidget {
  const _NameCard({
    super.key,
    required this.artwork,
    required this.name,
    this.subtitle,
    required this.onTap,
  });

  final Widget artwork;
  final String name;

  /// The line under the name. `null` leaves it off.
  final String? subtitle;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final subtitle = this.subtitle;
    return SizedBox(
      width: _nameCardWidth,
      child: InkWell(
        onTap: onTap,
        child: Column(
          children: [
            SizedBox.square(dimension: _nameArtworkSize, child: artwork),
            const SizedBox(height: 8),
            Flexible(
              child: AutospacedText(
                name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            if (subtitle != null)
              Flexible(
                child: AutospacedText(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
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

/// What the label or the author shelf shows while it is read: cards the size
/// the real ones come in, their artwork in [shape].
class _NameShelfSkeleton extends StatelessWidget {
  const _NameShelfSkeleton({
    required this.sectionKey,
    required this.height,
    required this.shape,
  });

  final String sectionKey;

  /// The height of the row the skeleton stands in for.
  final double height;
  final BoxShape shape;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;
    return SizedBox(
      key: ValueKey('$sectionKey-loading'),
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        physics: const NeverScrollableScrollPhysics(),
        itemCount: skeletonCardCount(context, cardWidth: _nameCardWidth),
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) => SizedBox(
          width: _nameCardWidth,
          child: Column(
            children: [
              Container(
                width: _nameArtworkSize,
                height: _nameArtworkSize,
                decoration: BoxDecoration(
                  color: color,
                  shape: shape,
                  borderRadius: shape == BoxShape.circle
                      ? null
                      : BorderRadius.circular(8),
                ),
              ),
              const SizedBox(height: 12),
              SkeletonLine(color: color, width: 72),
            ],
          ),
        ),
      ),
    );
  }
}

/// Height of the row of genre chips: one chip and its tap target.
const _genreRowHeight = 48.0;

/// The tenant's own classification, as one row of genres to step into.
///
/// A tenant that curates no genre is shown no row, heading included, since a
/// heading over nothing would announce a classification it does not have.
class _GenresShelf extends StatelessWidget {
  const _GenresShelf({required this.refreshes});

  final int refreshes;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return CatalogShelf<PublishedGenre>(
      sectionKey: 'catalog-genres',
      heading: messages.catalogGenresHeading,
      failureMessage: messages.catalogGenresFailed,
      reloadToken: '$refreshes',
      rowHeight: _genreRowHeight,
      skeleton: const _GenreRowSkeleton(),
      action: TextButton(
        key: const ValueKey('catalog-genres-all'),
        onPressed: () => context.pushInTab(AppRoutes.genresPath),
        child: AutospacedText(messages.catalogViewAll),
      ),
      load: (catalog) => catalog.listGenres(),
      cardBuilder: (context, genre) => Center(child: GenreChip(genre: genre)),
    );
  }
}

/// What the genre row shows while it is read: chips the size the real ones
/// come in.
class _GenreRowSkeleton extends StatelessWidget {
  const _GenreRowSkeleton();

  static const _chipWidth = 96.0;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      key: const ValueKey('catalog-genres-loading'),
      height: _genreRowHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        physics: const NeverScrollableScrollPhysics(),
        itemCount: skeletonCardCount(context, cardWidth: _chipWidth),
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) => Center(
          child: Container(
            width: _chipWidth,
            height: 32,
            decoration: BoxDecoration(
              color: colors.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
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
          child: SectionHeading(messages.catalogAllSeriesHeading),
        ),
        _list(messages),
      ],
    );
  }

  Widget _list(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      return SliverToBoxAdapter(
        child: CatalogMessage(
          key: const ValueKey('catalog-error'),
          message: catalogFailureCopy(
            messages,
            failure,
            messages.catalogLoadFailed,
          ),
          actionKey: const ValueKey('catalog-retry'),
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
        child: CatalogMessage(
          key: const ValueKey('catalog-empty'),
          message: messages.catalogEmpty,
        ),
      );
    }
    final columns = columnCount(context);
    final rows = rowCount(series.length, columns);
    return SliverPadding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      sliver: SliverList.separated(
        itemCount: rows + (hasFooter ? 1 : 0),
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index >= rows - _readAheadRows) {
            _readMore();
          }
          if (index == rows) {
            return _CatalogPageFooter(
              message: _moreFailure == null
                  ? null
                  : catalogFailureCopy(
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
          return ColumnRow(
            row: index,
            columns: columns,
            itemCount: series.length,
            itemBuilder: (context, index) => SeriesTile(series: series[index]),
          );
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
      child: RetryRow(
        sectionKey: 'catalog-more',
        message: message,
        onRetry: onRetry,
      ),
    );
  }
}
