import 'package:flutter/material.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// One genre of the genre list: its leading covers, then its name and how many
/// series are published under it, all one way into its series.
class GenreTile extends StatelessWidget {
  const GenreTile({super.key, required this.genre});

  final PublishedGenre genre;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return MergeSemantics(
      // A button the way a ListTile row is, which InkWell alone does not say.
      child: Semantics(
        button: true,
        child: InkWell(
          key: ValueKey('genre-tile-${genre.id}'),
          borderRadius: BorderRadius.circular(8),
          onTap: () => context.pushInTab(AppRoutes.genreDetailPath(genre.id)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _GenreCovers(genre: genre),
              const SizedBox(height: 8),
              Text(
                genre.name,
                style: theme.textTheme.titleSmall,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                messages.commonSeriesCount(
                  count: messages.formatInteger(genre.seriesCount),
                ),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// How many covers a tile holds: a 2×2 mosaic.
const _mosaicCells = 4;

/// Space between the cells of the mosaic.
const _cellGap = 2.0;

/// What a genre's tile draws in its portrait frame. The eye-catch the console
/// uploaded comes first, as its portrait cut filling the frame. Without one,
/// the genre's leading covers stand in as a 2×2 mosaic, so every tile is the
/// same size however many covers it has. The cells a genre cannot fill stay
/// flat, and a genre with no cover to draw — no series, or none with artwork —
/// is one flat frame carrying its name.
class _GenreCovers extends StatelessWidget {
  const _GenreCovers({required this.genre});

  final PublishedGenre genre;

  @override
  Widget build(BuildContext context) {
    if (genre.eyeCatchVariants.isNotEmpty) {
      return EyeCatchCover(
        kind: 'genre',
        id: genre.id,
        variants: genre.eyeCatchVariants,
        requestHeaders: genre.imageRequestHeaders,
        preferredTypes: const [eyeCatchPortrait],
        aspectRatio: 3 / 4,
        placeholderIcon: null,
      );
    }
    final covers = genre.featuredSeries.take(_mosaicCells).toList();
    if (!covers.any((series) => series.eyeCatchVariants.isNotEmpty)) {
      return _NameFrame(genre: genre);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: 3 / 4,
        child: Column(
          children: [
            Expanded(child: _row(covers, 0)),
            const SizedBox(height: _cellGap),
            Expanded(child: _row(covers, 2)),
          ],
        ),
      ),
    );
  }

  Widget _row(List<GenreFeaturedSeries> covers, int start) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: _cell(covers, start)),
        const SizedBox(width: _cellGap),
        Expanded(child: _cell(covers, start + 1)),
      ],
    );
  }

  Widget _cell(List<GenreFeaturedSeries> covers, int index) {
    if (index >= covers.length) {
      return _BlankCell(key: ValueKey('genre-${genre.id}-blank-$index'));
    }
    final series = covers[index];
    return EyeCatchCover(
      kind: 'series',
      id: series.id,
      variants: series.eyeCatchVariants,
      requestHeaders: genre.imageRequestHeaders,
      preferredTypes: const [eyeCatchPortrait],
      aspectRatio: 3 / 4,
      radius: 0,
      placeholderIcon: null,
    );
  }
}

/// A cell of the mosaic no series fills.
class _BlankCell extends StatelessWidget {
  const _BlankCell({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
    );
  }
}

/// The frame of a genre with no cover to draw, carrying its name in the covers'
/// place.
class _NameFrame extends StatelessWidget {
  const _NameFrame({required this.genre});

  final PublishedGenre genre;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ClipRRect(
      key: ValueKey('genre-${genre.id}-name-frame'),
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: 3 / 4,
        child: ColoredBox(
          color: theme.colorScheme.surfaceContainerHighest,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Center(
              // The name is read out beneath the frame already.
              child: ExcludeSemantics(
                child: Text(
                  genre.name,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
