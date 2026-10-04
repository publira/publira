import 'package:flutter/material.dart';
import 'package:publira/catalog/recommended_series_list.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The whole of the order recommended to the reader, which the catalog's
/// popularity shelf leads to while it stands in for a chart the tenant does
/// not have yet.
class RecommendedScreen extends StatelessWidget {
  const RecommendedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: AutospacedText(AppMessages.of(context).recommendedTitle),
      ),
      body: const RecommendedSeriesList(sectionKey: 'recommended'),
    );
  }
}
