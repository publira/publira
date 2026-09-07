import 'package:flutter/material.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/models/series_item.dart';

/// The cover of one series, drawn inside a box shaped by [aspectRatio].
///
/// The rendition is picked from what the series carries against the box's own
/// device-pixel width, and the image is decoded no larger than that: a stored
/// cover runs to 1600 pixels wide, and a list of them decoded at full size
/// would hold tens of megabytes of pixels for a column of thumbnails.
///
/// An eye-catch is served to every reader alike and never arrives encrypted,
/// so it is read straight off the network rather than through
/// `EpisodeImageClient`, which exists to reverse a body page's stream.
class SeriesCover extends StatelessWidget {
  const SeriesCover({
    super.key,
    required this.series,
    required this.preferredTypes,
    required this.aspectRatio,
  });

  final SeriesItem series;

  /// Rendition types this screen wants, best first. See
  /// [selectEyeCatchVariant].
  final List<String> preferredTypes;

  /// Shape the box takes where nothing else constrains it. The rendition is
  /// cropped to whatever box results, so a list stays even whichever cuts a
  /// series happens to carry.
  final double aspectRatio;

  @override
  Widget build(BuildContext context) {
    final placeholder = _CoverPlaceholder(
      key: ValueKey('series-cover-placeholder-${series.id}'),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final targetWidth =
                constraints.maxWidth * MediaQuery.devicePixelRatioOf(context);
            final variant = selectEyeCatchVariant(
              series.eyeCatchVariants,
              preferredTypes: preferredTypes,
              targetWidth: targetWidth,
            );
            if (variant == null) {
              return placeholder;
            }
            return Image(
              key: ValueKey('series-cover-${series.id}'),
              image: ResizeImage.resizeIfNeeded(
                // A box measured at nothing yet would ask for a zero-pixel
                // decode; the full rendition is the honest answer until the
                // layout has a width.
                targetWidth >= 1 ? targetWidth.round() : null,
                null,
                NetworkImage(
                  variant.url.toString(),
                  headers: series.imageRequestHeaders,
                ),
              ),
              fit: BoxFit.cover,
              // The cover repeats the title it sits beside, so announcing it
              // would read the series out twice.
              excludeFromSemantics: true,
              // A cover still arriving and a cover that never will look the
              // same on purpose: the box is already the size it will keep, so
              // a spinner would only flicker in it.
              loadingBuilder: (context, child, progress) =>
                  progress == null ? child : placeholder,
              errorBuilder: (context, error, stackTrace) => placeholder,
            );
          },
        ),
      ),
    );
  }
}

/// What fills the box when there is no cover to draw.
class _CoverPlaceholder extends StatelessWidget {
  const _CoverPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      color: colors.surfaceContainerHighest,
      child: Center(
        child: Icon(
          Icons.collections_bookmark_outlined,
          color: colors.onSurfaceVariant,
        ),
      ),
    );
  }
}
