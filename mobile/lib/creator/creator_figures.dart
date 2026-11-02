import 'package:flutter/material.dart';
import 'package:publira/catalog/creator_tile.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/typography/autospaced_text.dart';

/// One headline figure of an Author's pages: its name above its value, the
/// value set large.
class CreatorFigure extends StatelessWidget {
  const CreatorFigure({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 140),
      child: Card.outlined(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              AutospacedText(
                label,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 4),
              AutospacedText(value, style: theme.textTheme.headlineSmall),
            ],
          ),
        ),
      ),
    );
  }
}

/// A row of headline figures, wrapping onto as many lines as the width needs.
class CreatorFigureGrid extends StatelessWidget {
  const CreatorFigureGrid({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) =>
      Wrap(spacing: 8, runSpacing: 8, children: children);
}

/// The figures of one row of a list — an episode, a month, a line — each a
/// name followed by its value, wrapping as the width needs. A name and its
/// value are laid out apart rather than joined in one string, so no locale's
/// word order is assumed.
class CreatorFigureLine extends StatelessWidget {
  const CreatorFigureLine({super.key, required this.figures});

  /// Each figure as its name and its formatted value, keyed for a test.
  final List<({Key? key, String label, String value})> figures;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labelStyle = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final valueStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.w600,
    );
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        spacing: 16,
        runSpacing: 4,
        children: [
          for (final figure in figures)
            Row(
              key: figure.key,
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                AutospacedText(figure.label, style: labelStyle),
                const SizedBox(width: 4),
                AutospacedText(figure.value, style: valueStyle),
              ],
            ),
        ],
      ),
    );
  }
}

/// A heading of an Author's pages and the sentence under it.
class CreatorSectionHeading extends StatelessWidget {
  const CreatorSectionHeading({
    super.key,
    required this.title,
    required this.description,
  });

  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AutospacedText(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          AutospacedText(
            description,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// The Author's portrait and name, with [subtitle] under the name.
class CreatorPagesHeader extends StatelessWidget {
  const CreatorPagesHeader({
    super.key,
    required this.creator,
    required this.subtitle,
  });

  final MyCreator creator;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      leading: CreatorPortrait(
        creator: PublishedCreator(
          id: creator.publicId,
          name: creator.name,
          iconUrl: creator.iconUrl,
          imageRequestHeaders: creator.imageRequestHeaders,
        ),
        radius: 28,
      ),
      title: AutospacedText(creator.name, style: theme.textTheme.titleLarge),
      subtitle: AutospacedText(subtitle),
    );
  }
}

/// What a failed `CreatorService` read says: the transport and the session
/// in the app's shared words, a page the reader may no longer read as
/// [CreatorFailureKind.unavailable] is, and anything else as [fallback].
String creatorFailureCopy(
  AppMessages messages,
  CreatorFailure failure, {
  required String fallback,
}) => switch (failure.kind) {
  CreatorFailureKind.network => messages.errorsRpcUnavailable,
  CreatorFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
  CreatorFailureKind.unavailable => messages.creatorPagesNotFound,
  CreatorFailureKind.unexpected => fallback,
};
