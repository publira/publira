import 'package:flutter/material.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/models/series_item.dart';

/// The picture at the head of a row that stands for one episode: the
/// episode's own eye-catch, or its series' where the episode has none.
///
/// Every list of episodes draws it in the same box, 16:9 and 80 dp wide,
/// which stays inside a one-line row's height with room above and below, so
/// the pictures of adjacent rows do not run together. Falling back to the
/// series' cover keeps a row without artwork of its own from showing a gap
/// where its picture would be.
class EpisodeCover extends StatelessWidget {
  const EpisodeCover({
    super.key,
    required this.episodeId,
    required this.variants,
    required this.seriesVariants,
    required this.requestHeaders,
  });

  /// Public id of the episode, which names the image and its placeholder on
  /// screen.
  final String episodeId;

  /// Renditions of the episode's own eye-catch.
  final List<EyeCatchVariant> variants;

  /// Renditions of its series' eye-catch, drawn where [variants] is empty.
  final List<EyeCatchVariant> seriesVariants;

  /// Headers either set of renditions is fetched with. An episode's eye-catch
  /// is served to every reader alike, as its series' is.
  final Map<String, String> requestHeaders;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 80,
      child: EyeCatchCover(
        kind: 'episode',
        id: episodeId,
        variants: variants.isEmpty ? seriesVariants : variants,
        requestHeaders: requestHeaders,
        preferredTypes: const [eyeCatchLandscape, eyeCatchPortrait],
        aspectRatio: 16 / 9,
      ),
    );
  }
}
