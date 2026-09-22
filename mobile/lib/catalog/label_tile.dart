import 'package:flutter/material.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// One row of a list of labels, which opens the label's screen.
class LabelTile extends StatelessWidget {
  const LabelTile({super.key, required this.label});

  final PublishedLabel label;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: ValueKey('label-tile-${label.id}'),
      // 42 is the width a series row gives its cover, so the two kinds of row
      // line up when they stand in one list.
      leading: SizedBox(
        width: 42,
        child: EyeCatchCover(
          kind: 'label',
          id: label.id,
          variants: label.eyeCatchVariants,
          requestHeaders: label.imageRequestHeaders,
          preferredTypes: const [eyeCatchSquare],
          aspectRatio: 1,
        ),
      ),
      title: Text(label.name),
      onTap: () => context.pushInTab(AppRoutes.labelDetailPath(label.id)),
    );
  }
}
