import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_shelf.dart';
import 'package:publira/catalog/classified_series_view.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// A genre the tenant curates: the leaders of its week, then its published
/// series under the sort and filters the reader picks.
class GenreScreen extends StatelessWidget {
  const GenreScreen({super.key, required this.genreId});

  final String genreId;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ClassifiedSeriesView(
      sectionKey: 'genre',
      title: messages.genreTitle,
      notFoundMessage: messages.genreNotFound(id: genreId),
      loadFailedMessage: messages.genreLoadFailed,
      seriesEmptyMessage: messages.genreSeriesEmpty,
      // The genre list is the only read that names a genre, and it is short:
      // the tenant curates it by hand.
      readClassification: (catalog) async {
        final genres = await catalog.listGenres();
        final genre = genres.where((genre) => genre.id == genreId).firstOrNull;
        return genre == null
            ? null
            : Classification(
                id: genre.id,
                name: genre.name,
                seriesCount: genre.seriesCount,
                eyeCatchVariants: genre.eyeCatchVariants,
                imageRequestHeaders: genre.imageRequestHeaders,
              );
      },
      readSeries: (catalog, filter, token) =>
          catalog.listGenreSeries(genreId, filter: filter, token: token),
      lead: _GenreRankingShelf(genreId: genreId),
    );
  }
}

/// As many of the genre's leaders as the catalog's chart holds of the
/// tenant's, so the two rows scroll the same distance.
const _rankingLimit = 10;

/// The top of the genre's weekly chart, in the positions the last ranking
/// snapshot recorded.
///
/// A genre the ranking batch has not reached yet, or one nobody has read this
/// week, is shown no row, heading included, so the screen opens on its filters
/// and its list as it did before genres were ranked. The chart is an all-ages
/// one, the only one a genre has, so it hides no cover.
///
/// The storefront's genre page links its row to the rest of the chart. The
/// app's ranking screen cannot be narrowed to a genre yet (#3575), and the
/// tenant-wide chart it would open on is not this genre's, so the row offers
/// no such way out.
class _GenreRankingShelf extends StatelessWidget {
  const _GenreRankingShelf({required this.genreId});

  final String genreId;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return CatalogShelf<RankedSeriesItem>(
      sectionKey: 'genre-ranking',
      heading: messages.genreRankingHeading,
      failureMessage: messages.genreRankingFailed,
      reloadToken: genreId,
      load: (catalog) async => (await catalog.listRankedSeries(
        limit: _rankingLimit,
        period: RankingPeriod.weekly,
        ageRating: SeriesAgeRating.all,
        genreId: genreId,
      )).rankedSeries,
      cardBuilder: (context, item) => SeriesShelfCard(
        key: ValueKey('genre-ranking-${item.series.id}'),
        series: item.series,
        subtitle: item.series.creators.isEmpty
            ? null
            : CreatorCredits(credits: item.series.creators),
        rank: item.rank,
        onTap: () =>
            context.pushInTab(AppRoutes.seriesDetailPath(item.series.id)),
      ),
    );
  }
}
