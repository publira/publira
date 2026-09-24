import 'package:flutter/material.dart';
import 'package:publira/catalog/classified_series_view.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// A tag published series carry, and those series.
class TagScreen extends StatelessWidget {
  const TagScreen({super.key, required this.tagSlug});

  final String tagSlug;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ClassifiedSeriesView(
      sectionKey: 'tag',
      title: messages.tagTitle,
      notFoundMessage: messages.tagNotFound(slug: tagSlug),
      loadFailedMessage: messages.tagLoadFailed,
      seriesEmptyMessage: messages.tagSeriesEmpty,
      readClassification: (catalog) async {
        final tag = await catalog.getTag(tagSlug);
        return tag == null
            ? null
            : Classification(name: tag.name, seriesCount: tag.seriesCount);
      },
      readSeries: (catalog, filter, token) =>
          catalog.listTagSeries(tagSlug, filter: filter, token: token),
    );
  }
}
