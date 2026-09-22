import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// One row of a list of authors, which opens the author's screen.
class CreatorTile extends StatelessWidget {
  const CreatorTile({super.key, required this.creator});

  final PublishedCreator creator;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ListTile(
      key: ValueKey('creator-tile-${creator.id}'),
      leading: CreatorPortrait(creator: creator, radius: 20),
      title: Text(creator.name),
      subtitle: Text(
        messages.commonSeriesCount(
          count: messages.formatInteger(creator.seriesCount),
        ),
      ),
      onTap: () => context.pushInTab(AppRoutes.creatorDetailPath(creator.id)),
    );
  }
}

/// An author's portrait in a circle [radius] logical pixels wide, and an icon
/// in its place for an author who has none or whose portrait cannot be
/// fetched.
class CreatorPortrait extends StatelessWidget {
  const CreatorPortrait({
    super.key,
    required this.creator,
    required this.radius,
  });

  final PublishedCreator creator;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final iconUrl = creator.iconUrl;
    final colors = Theme.of(context).colorScheme;
    return CircleAvatar(
      radius: radius,
      backgroundColor: colors.surfaceContainerHighest,
      // Decoded no larger than the circle, for the reason a cover is.
      foregroundImage: iconUrl == null
          ? null
          : ResizeImage.resizeIfNeeded(
              (radius * 2 * MediaQuery.devicePixelRatioOf(context)).round(),
              null,
              NetworkImage(
                iconUrl.toString(),
                headers: creator.imageRequestHeaders,
              ),
            ),
      onForegroundImageError: iconUrl == null ? null : (_, _) {},
      child: Icon(Icons.person_outline, color: colors.onSurfaceVariant),
    );
  }
}
