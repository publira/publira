import 'package:publira/models/series_item.dart';

/// Eye-catch renditions cut taller than they are wide, which is the shape a
/// catalog tile reserves.
const eyeCatchPortrait = 'portrait';

/// Eye-catch renditions cut wider than they are tall, which is the shape a
/// detail screen banner reserves.
const eyeCatchLandscape = 'landscape';

/// Picks the rendition to draw a cover [targetWidth] device pixels wide.
///
/// [preferredTypes] is read in order, and the first type the series actually
/// carries decides the pool: the renditions are independent images, so a
/// series with a portrait cut and no landscape one is ordinary rather than
/// broken. A series carrying none of them still has a cover to show, so the
/// pool falls back to every rendition it does carry.
///
/// Inside the pool the nearest stored width wins, and a tie goes to the wider
/// one: an image drawn slightly larger than the box is the one that stays
/// sharp. Returns `null` when there is nothing to draw.
EyeCatchVariant? selectEyeCatchVariant(
  List<EyeCatchVariant> variants, {
  required List<String> preferredTypes,
  required double targetWidth,
}) {
  // A rendition is addressed by its own width, so one that reports none names
  // no image to request.
  final usable = variants.where((variant) => variant.width > 0);
  if (usable.isEmpty) {
    return null;
  }

  var pool = usable;
  for (final type in preferredTypes) {
    final matching = usable.where((variant) => variant.variantType == type);
    if (matching.isNotEmpty) {
      pool = matching;
      break;
    }
  }

  return pool.reduce((best, variant) {
    final bestDistance = (best.width - targetWidth).abs();
    final distance = (variant.width - targetWidth).abs();
    if (distance == bestDistance) {
      return variant.width > best.width ? variant : best;
    }
    return distance < bestDistance ? variant : best;
  });
}
