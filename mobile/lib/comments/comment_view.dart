import 'package:material_ui/material_ui.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_comment.dart';
import 'package:publira/typography/autospaced_text.dart';

/// One comment as every list of comments draws it: the author's icon, their
/// name with the Author badge when the episode credits them, the date, and
/// the text.
///
/// [trailing] sits at the end of the author's line, for what one list alone
/// says about the comment.
class CommentContent extends StatelessWidget {
  const CommentContent({super.key, required this.comment, this.trailing});

  final EpisodeComment comment;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final createdAt = comment.createdAt;
    final trailing = this.trailing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _AuthorIcon(comment: comment),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      AutospacedText(
                        comment.displayName,
                        style: theme.textTheme.titleSmall,
                      ),
                      if (comment.creatorName.isNotEmpty) const _CreatorBadge(),
                    ],
                  ),
                  if (createdAt != null)
                    AutospacedText(
                      AppMessages.of(context).formatDateTime(createdAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
            ?trailing,
          ],
        ),
        const SizedBox(height: 8),
        AutospacedText(comment.body),
      ],
    );
  }
}

/// The way to the pages either side of a page of comments.
///
/// The lists are newest first, so the previous page holds the newer comments
/// and the next page the older ones, which is what the labels say rather than
/// naming a direction the reader has to work out.
class CommentPagination extends StatelessWidget {
  const CommentPagination({
    super.key,
    required this.previousToken,
    required this.nextToken,
    required this.onShowPage,
  });

  final String previousToken;
  final String nextToken;
  final ValueChanged<String> onShowPage;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        TextButton(
          key: const ValueKey('comment-newer-page'),
          onPressed: previousToken.isEmpty
              ? null
              : () => onShowPage(previousToken),
          child: AutospacedText(messages.commentsNewer),
        ),
        TextButton(
          key: const ValueKey('comment-older-page'),
          onPressed: nextToken.isEmpty ? null : () => onShowPage(nextToken),
          child: AutospacedText(messages.commentsOlder),
        ),
      ],
    );
  }
}

/// The mark beside a comment by a creator the episode credits.
///
/// It says so in words rather than in colour alone, so a reader who cannot
/// tell the colour apart still reads it, and a screen reader announces it
/// after the name it follows.
class _CreatorBadge extends StatelessWidget {
  const _CreatorBadge();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      key: const ValueKey('comment-creator-badge'),
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: AutospacedText(
          AppMessages.of(context).commentsCreatorBadge,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}

/// The icon a comment's author shows, in a circle beside their name, and an
/// icon in its place for an author who shows none or whose icon cannot be
/// fetched.
class _AuthorIcon extends StatelessWidget {
  const _AuthorIcon({required this.comment});

  final EpisodeComment comment;

  static const _radius = 20.0;

  @override
  Widget build(BuildContext context) {
    final iconUrl = comment.authorIconUrl;
    final colors = Theme.of(context).colorScheme;
    return CircleAvatar(
      key: ValueKey(
        iconUrl == null
            ? 'comment-author-icon-fallback-${comment.id}'
            : 'comment-author-icon-${comment.id}',
      ),
      radius: _radius,
      backgroundColor: colors.surfaceContainerHighest,
      // Decoded no larger than the circle, for the reason a cover is.
      foregroundImage: iconUrl == null
          ? null
          : ResizeImage.resizeIfNeeded(
              (_radius * 2 * MediaQuery.devicePixelRatioOf(context)).round(),
              null,
              NetworkImage(
                iconUrl.toString(),
                headers: comment.imageRequestHeaders,
              ),
            ),
      onForegroundImageError: iconUrl == null ? null : (_, _) {},
      child: Icon(Icons.person_outline, color: colors.onSurfaceVariant),
    );
  }
}
