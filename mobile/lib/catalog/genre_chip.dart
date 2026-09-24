import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// One genre as a way into its series, with the count that tells a reader
/// whether following it is worth it.
class GenreChip extends StatelessWidget {
  const GenreChip({super.key, required this.genre});

  final PublishedGenre genre;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return ActionChip(
      key: ValueKey('genre-chip-${genre.id}'),
      label: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: genre.name),
            const TextSpan(text: '  '),
            TextSpan(
              text: messages.formatInteger(genre.seriesCount),
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      onPressed: () => context.pushInTab(AppRoutes.genreDetailPath(genre.id)),
    );
  }
}
