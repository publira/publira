import 'package:flutter/material.dart';
import 'package:publira/catalog/classified_series_view.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// A genre the tenant curates, and its published series.
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
    );
  }
}
