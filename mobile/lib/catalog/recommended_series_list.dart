import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/paged_list.dart';
import 'package:publira/catalog/series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

/// How many series one page of the list asks for, the API's own default.
const _pageSize = 20;

/// Every published series in the order recommended to the reader, one cursor
/// page at a time, each row opening its series.
///
/// A signed-in reader is read their own order, and a guest the tenant's, which
/// is the one every guest is shown; a sign-in or a sign-out therefore reads
/// the list again from the top rather than going on in the other reader's
/// order.
class RecommendedSeriesList extends StatefulWidget {
  const RecommendedSeriesList({super.key, required this.sectionKey});

  /// Names the list on screen, the way [PagedList.sectionKey] does.
  final String sectionKey;

  @override
  State<RecommendedSeriesList> createState() => _RecommendedSeriesListState();
}

class _RecommendedSeriesListState extends State<RecommendedSeriesList> {
  CatalogRepository? _catalog;
  String? _readerId;
  CatalogPager<SeriesItem, Null>? _pager;

  /// Reads the list again whenever the reader or the repository changes: the
  /// order is the reader's own, and the tokens under it belong to the
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
    Future<CatalogPageRead<SeriesItem, Null>> read(String token) async {
      final page = readerId.isEmpty
          ? await catalog.listRecommendedSeries(limit: _pageSize, token: token)
          : await catalog.listMyRecommendedSeries(
              limit: _pageSize,
              token: token,
            );
      return CatalogPageRead(items: page.series, nextToken: page.nextToken);
    }

    (_pager ??= CatalogPager(read)).restart(read);
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  /// The footer's retry. A later page the API refuses is a token from the
  /// other order — the recommendation batch wrote or dropped the reader's
  /// features since the page above it — and asking for it again is refused
  /// again, so the list starts over from the first page of the order that
  /// stands now.
  void _retryMore() {
    final pager = _pager!;
    if (pager.moreFailure?.refused ?? false) {
      pager.restart();
    } else {
      pager.retryMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return PagedList(
      pager: _pager!,
      sectionKey: widget.sectionKey,
      emptyMessage: messages.catalogEmpty,
      failedMessage: messages.recommendedLoadFailed,
      itemBuilder: (series) => SeriesTile(series: series),
      onRetryMore: _retryMore,
    );
  }
}
