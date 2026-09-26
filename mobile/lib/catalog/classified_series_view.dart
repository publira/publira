import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/catalog/series_filter_bar.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';

/// What a genre or a tag is called, how many published series carry it, and
/// the eye-catch its header opens on.
class Classification {
  const Classification({
    required this.id,
    required this.name,
    required this.seriesCount,
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
  });

  /// What addresses it: a genre's public id, or a tag's slug.
  final String id;
  final String name;
  final int seriesCount;

  /// Empty for a tag, which has no artwork, and for a genre with none.
  final List<EyeCatchVariant> eyeCatchVariants;

  /// Headers [eyeCatchVariants] must be fetched with.
  final Map<String, String> imageRequestHeaders;
}

/// Reads the classification a screen is about, or `null` when the tenant has
/// no such one.
typedef ClassificationReader =
    Future<Classification?> Function(CatalogRepository catalog);

/// Reads one page of the series carrying the classification, or `null` when
/// the API answers that it does not exist.
typedef ClassifiedSeriesReader =
    Future<SeriesPage?> Function(
      CatalogRepository catalog,
      SeriesListFilter filter,
      String token,
    );

/// A genre or a tag: its name, and its published series one cursor page at a
/// time, under the sort and filters the reader picked.
///
/// The controls are the ones the storefront's genre and tag pages carry — the
/// sort, the serialization state, and the free-to-start filter. The weekday
/// schedule is not among them: the storefront offers it on the list of every
/// series, where the week is the way in, rather than as a narrowing of one
/// genre or tag.
class ClassifiedSeriesView extends StatefulWidget {
  const ClassifiedSeriesView({
    super.key,
    required this.sectionKey,
    required this.title,
    required this.notFoundMessage,
    required this.loadFailedMessage,
    required this.seriesEmptyMessage,
    required this.readClassification,
    required this.readSeries,
  });

  /// Names the screen's states: `<sectionKey>-body`, `-loading`, `-error`,
  /// `-retry`, `-not-found`, and the list as `<sectionKey>-series`.
  final String sectionKey;

  /// The app bar's title until the classification has been read.
  final String title;

  final String notFoundMessage;
  final String loadFailedMessage;

  /// What stands in place of the rows when nothing narrows the list and it is
  /// still empty.
  final String seriesEmptyMessage;

  final ClassificationReader readClassification;
  final ClassifiedSeriesReader readSeries;

  @override
  State<ClassifiedSeriesView> createState() => _ClassifiedSeriesViewState();
}

class _ClassifiedSeriesViewState extends State<ClassifiedSeriesView> {
  CatalogRepository? _catalog;
  CatalogPager<SeriesItem, Classification>? _pager;
  var _filter = const SeriesListFilter();

  /// The classification once read, which a changed filter keeps rather than
  /// reading again: only the series under it change.
  Classification? _classification;

  /// Reads everything again whenever the repository changes, for the reason
  /// the author screen does.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _classification = null;
    _restart();
  }

  void _restart() {
    final catalog = _catalog!;
    final filter = _filter;
    final known = _classification;
    Future<CatalogPageRead<SeriesItem, Classification>?> read(
      String token,
    ) async {
      // The pager keeps the first page's header alone, so a later page reads
      // only its series.
      if (token.isNotEmpty) {
        final series = await widget.readSeries(catalog, filter, token);
        return series == null
            ? null
            : CatalogPageRead(
                items: series.series,
                nextToken: series.nextToken,
              );
      }
      final classification = known == null
          ? widget.readClassification(catalog)
          : Future.value(known);
      final page = widget.readSeries(catalog, filter, token);
      final Classification? header;
      final SeriesPage? series;
      try {
        (header, series) = await (classification, page).wait;
      } on ParallelWaitError<
        (Classification?, SeriesPage?),
        (AsyncError?, AsyncError?)
      > catch (error) {
        // The pager tells a failure apart by its type, so the first of the two
        // is thrown as it came.
        final failed = error.errors.$1 ?? error.errors.$2!;
        Error.throwWithStackTrace(failed.error, failed.stackTrace);
      }
      if (header == null || series == null) {
        return null;
      }
      return CatalogPageRead(
        items: series.series,
        nextToken: series.nextToken,
        header: header,
      );
    }

    (_pager ??= CatalogPager(read)).restart(read);
  }

  void _changeFilter(SeriesListFilter filter) {
    if (filter == _filter) {
      return;
    }
    setState(() => _filter = filter);
    _restart();
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pager = _pager!;
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final classification = _classification ??= pager.header;
        return Scaffold(
          appBar: AppBar(title: Text(classification?.name ?? widget.title)),
          body: _body(pager, classification),
        );
      },
    );
  }

  Widget _body(
    CatalogPager<SeriesItem, Classification> pager,
    Classification? classification,
  ) {
    final messages = AppMessages.of(context);
    final key = widget.sectionKey;
    if (pager.notFound) {
      return CatalogMessage(
        key: ValueKey('$key-not-found'),
        message: widget.notFoundMessage,
        actionLabel: messages.commonBackToCatalog,
        onAction: () => context.goNamed('catalog'),
      );
    }
    final failure = pager.failure;
    if (classification == null) {
      if (failure != null) {
        return CatalogMessage(
          key: ValueKey('$key-error'),
          message: catalogFailureCopy(
            messages,
            failure,
            widget.loadFailedMessage,
          ),
          actionKey: ValueKey('$key-retry'),
          actionLabel: messages.commonRetry,
          onAction: _restart,
        );
      }
      return Center(
        key: ValueKey('$key-loading'),
        child: const CircularProgressIndicator(),
      );
    }
    return CustomScrollView(
      key: ValueKey('$key-body'),
      slivers: [
        SliverToBoxAdapter(
          child: _ClassificationHeader(
            kind: key,
            classification: classification,
          ),
        ),
        SliverToBoxAdapter(
          child: SeriesFilterBar(filter: _filter, onChanged: _changeFilter),
        ),
        ..._series(messages, pager, failure),
      ],
    );
  }

  /// The rows under the controls, which a changed filter reads again while
  /// the name and the controls stay where they are.
  List<Widget> _series(
    AppMessages messages,
    CatalogPager<SeriesItem, Classification> pager,
    Object? failure,
  ) {
    final key = widget.sectionKey;
    if (failure != null) {
      return [
        SliverToBoxAdapter(
          child: RetryRow(
            sectionKey: '$key-series',
            message: catalogFailureCopy(
              messages,
              failure,
              messages.commonMoreSeriesFailed,
            ),
            onRetry: _restart,
          ),
        ),
      ];
    }
    final series = pager.items;
    if (series == null) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            key: ValueKey('$key-series-loading'),
            padding: const EdgeInsets.all(16),
            child: const Center(child: CircularProgressIndicator()),
          ),
        ),
      ];
    }
    if (series.isEmpty && !pager.hasFooter && _filter.narrows) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            key: ValueKey('$key-series-filtered-empty'),
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(messages.seriesFilterEmpty),
                const SizedBox(height: 8),
                TextButton(
                  key: ValueKey('$key-series-filter-clear'),
                  onPressed: () =>
                      _changeFilter(SeriesListFilter(order: _filter.order)),
                  child: Text(messages.seriesFilterClear),
                ),
              ],
            ),
          ),
        ),
      ];
    }
    return [
      PagedSeriesSliver(
        pager: pager,
        sectionKey: '$key-series',
        emptyMessage: widget.seriesEmptyMessage,
      ),
    ];
  }
}

class _ClassificationHeader extends StatelessWidget {
  const _ClassificationHeader({
    required this.kind,
    required this.classification,
  });

  /// What [classification] is, which names its eye-catch on screen.
  final String kind;

  final Classification classification;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (classification.eyeCatchVariants.isNotEmpty) ...[
            // Capped for the reason the label's banner is.
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: EyeCatchCover(
                kind: kind,
                id: classification.id,
                variants: classification.eyeCatchVariants,
                requestHeaders: classification.imageRequestHeaders,
                preferredTypes: const [eyeCatchLandscape, eyeCatchSquare],
                aspectRatio: 16 / 9,
              ),
            ),
            const SizedBox(height: 16),
          ],
          Text(classification.name, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(
            messages.commonSeriesCount(
              count: messages.formatInteger(classification.seriesCount),
            ),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
