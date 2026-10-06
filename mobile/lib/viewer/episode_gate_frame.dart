import 'dart:math';

import 'package:flutter/material.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/viewer/page_spreads.dart';

/// What stands where the reader would be when a gate closes the body: the
/// reader's own dark screen, the opening pages laid into it, and the gate's
/// card floating over them. The reader sees the work they are being asked
/// about rather than a description of it.
///
/// The pages are the server's renditions, blurred before they leave it, and
/// nothing here blurs them again or could unblur them: the full page is never
/// sent, so no widget on this screen holds one. They are decoration beside the
/// card, which says everything the reader needs, so a screen reader is told
/// nothing about them.
///
/// Two pages side by side are a spread, so a right-to-left work puts the first
/// one on the right. Where the reader would show one page at a time, the frame
/// shows the first alone.
class EpisodeGateFrame extends StatelessWidget {
  const EpisodeGateFrame({
    super.key,
    required this.previewImages,
    required this.previewHeaders,
    required this.readingDirection,
    required this.message,
    this.badge,
    this.title,
    this.notice,
    this.actions = const [],
    this.footer,
  });

  final List<EpisodeImageItem> previewImages;

  /// Headers [previewImages] are fetched with.
  final Map<String, String> previewHeaders;

  final ReadingDirection readingDirection;

  /// A mark above [title] about the episode itself rather than the gate.
  final Widget? badge;

  /// What the gate is about, where it has a heading of its own.
  final String? title;

  /// Why the body is closed.
  final String message;

  /// One more thing the reader is told under [message], about a way into the
  /// body the gate offers besides the usual one.
  final Widget? notice;

  /// What the reader can do about it, the one that opens the body first.
  final List<Widget> actions;

  /// A way around the gate rather than through it, under [actions].
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final badge = this.badge;
    final title = this.title;
    final notice = this.notice;
    final footer = this.footer;
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          fit: StackFit.expand,
          children: [
            if (previewImages.isNotEmpty)
              ExcludeSemantics(
                child: _PreviewSpread(
                  images: PageSpreads.pairsOn(constraints.biggest)
                      ? previewImages.take(2).toList()
                      : [previewImages.first],
                  headers: previewHeaders,
                  readingDirection: readingDirection,
                  viewport: constraints.biggest,
                ),
              ),
            // A tall card on a short screen scrolls rather than overflowing,
            // and a short one stays centred over the pages.
            SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 40,
                    ),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 560),
                      child: Card(
                        key: const ValueKey('episode-gate-card'),
                        margin: EdgeInsets.zero,
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (badge != null) ...[
                                badge,
                                const SizedBox(height: 12),
                              ],
                              if (title != null) ...[
                                AutospacedText(
                                  title,
                                  textAlign: TextAlign.center,
                                  style: theme.textTheme.titleLarge,
                                ),
                                const SizedBox(height: 8),
                              ],
                              AutospacedText(
                                message,
                                textAlign: TextAlign.center,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                              if (notice != null) ...[
                                const SizedBox(height: 12),
                                notice,
                              ],
                              if (actions.isNotEmpty) ...[
                                const SizedBox(height: 24),
                                Wrap(
                                  alignment: WrapAlignment.center,
                                  spacing: 12,
                                  runSpacing: 12,
                                  children: actions,
                                ),
                              ],
                              if (footer != null) ...[
                                const SizedBox(height: 16),
                                footer,
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The preview pages, each as tall as the screen and no wider than its share
/// of it, centred side by side in reading order.
class _PreviewSpread extends StatelessWidget {
  const _PreviewSpread({
    required this.images,
    required this.headers,
    required this.readingDirection,
    required this.viewport,
  });

  final List<EpisodeImageItem> images;
  final Map<String, String> headers;
  final ReadingDirection readingDirection;
  final Size viewport;

  @override
  Widget build(BuildContext context) {
    final share = viewport.width / images.length;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      // A row lays its children out from its text direction's start, so a
      // right-to-left row is what puts the first page on the right.
      textDirection: readingDirection == ReadingDirection.rtl
          ? TextDirection.rtl
          : TextDirection.ltr,
      children: [
        for (final image in images)
          SizedBox(
            width: image.width > 0 && image.height > 0
                ? min(viewport.height * image.width / image.height, share)
                : share,
            height: viewport.height,
            // The rendition is a few dozen pixels across and already blurred,
            // so it is drawn as it comes at whatever size the box asks for.
            // One that fails leaves the dark screen behind it, which is what
            // a gate without a preview shows anyway.
            child: Image(
              key: ValueKey('episode-gate-preview-${image.id}'),
              image: NetworkImage(image.url.toString(), headers: headers),
              fit: BoxFit.cover,
              excludeFromSemantics: true,
              errorBuilder: (context, error, stackTrace) =>
                  const SizedBox.shrink(),
            ),
          ),
      ],
    );
  }
}
