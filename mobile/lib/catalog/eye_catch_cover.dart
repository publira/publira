import 'package:flutter/material.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/models/series_item.dart';

/// The eye-catch of one series, label, or genre, drawn inside a box shaped by
/// [aspectRatio].
///
/// The rendition is picked from what [variants] carries against the box's own
/// device-pixel width, and the image is decoded no larger than that: a stored
/// cover runs to 1600 pixels wide, and a list of them decoded at full size
/// would hold tens of megabytes of pixels for a column of thumbnails.
///
/// An eye-catch is served to every reader alike and never arrives encrypted,
/// so it is read straight off the network rather than through
/// `EpisodeImageClient`, which exists to reverse a body page's stream.
class EyeCatchCover extends StatelessWidget {
  const EyeCatchCover({
    super.key,
    required this.kind,
    required this.id,
    required this.variants,
    required this.requestHeaders,
    required this.preferredTypes,
    required this.aspectRatio,
    this.radius = 8,
    this.placeholderIcon = Icons.collections_bookmark_outlined,
  });

  /// What the artwork belongs to, `series`, `label`, or `genre`, which with
  /// [id] names the image and its placeholder on screen.
  final String kind;

  /// Public id of what the artwork belongs to.
  final String id;

  final List<EyeCatchVariant> variants;

  /// Headers [variants] must be fetched with.
  final Map<String, String> requestHeaders;

  /// Rendition types this screen wants, best first. See
  /// [selectEyeCatchVariant].
  final List<String> preferredTypes;

  /// Shape the box takes where nothing else constrains it. The rendition is
  /// cropped to whatever box results, so a list stays even whichever cuts an
  /// eye-catch happens to carry.
  final double aspectRatio;

  /// Rounding of the box's corners. A cell of a larger frame that clips its
  /// own corners draws square.
  final double radius;

  /// What marks the box as a cover still to come. `null` leaves it flat.
  final IconData? placeholderIcon;

  @override
  Widget build(BuildContext context) {
    final placeholder = _CoverPlaceholder(
      key: ValueKey('$kind-cover-placeholder-$id'),
      icon: placeholderIcon,
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final targetWidth =
                constraints.maxWidth * MediaQuery.devicePixelRatioOf(context);
            final variant = selectEyeCatchVariant(
              variants,
              preferredTypes: preferredTypes,
              targetWidth: targetWidth,
            );
            if (variant == null) {
              return placeholder;
            }
            return Image(
              key: ValueKey('$kind-cover-$id'),
              image: ResizeImage.resizeIfNeeded(
                // A box measured at nothing yet would ask for a zero-pixel
                // decode; the full rendition is the honest answer until the
                // layout has a width.
                targetWidth >= 1 ? targetWidth.round() : null,
                null,
                NetworkImage(variant.url.toString(), headers: requestHeaders),
              ),
              fit: BoxFit.cover,
              // The artwork repeats the name it sits beside, so announcing it
              // would read the name out twice.
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
  const _CoverPlaceholder({super.key, required this.icon});

  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final icon = this.icon;
    return ColoredBox(
      color: colors.surfaceContainerHighest,
      child: icon == null
          ? null
          : Center(child: Icon(icon, color: colors.onSurfaceVariant)),
    );
  }
}
