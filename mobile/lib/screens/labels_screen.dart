import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/label_tile.dart';
import 'package:publira/catalog/paged_list.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Every label the tenant shows in the app, the most recently registered
/// first, one cursor page at a time, each a way into the label's screen.
class LabelsScreen extends StatefulWidget {
  const LabelsScreen({super.key});

  @override
  State<LabelsScreen> createState() => _LabelsScreenState();
}

class _LabelsScreenState extends State<LabelsScreen> {
  CatalogRepository? _catalog;
  CatalogPager<PublishedLabel, Null>? _pager;

  /// Reads the list again whenever the repository changes, for the reason the
  /// author screen does.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    Future<CatalogPageRead<PublishedLabel, Null>> read(String token) async {
      final page = await catalog.listLabels(token: token);
      return CatalogPageRead(items: page.labels, nextToken: page.nextToken);
    }

    (_pager ??= CatalogPager(read)).restart(read);
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.labelsTitle)),
      body: PagedList(
        pager: _pager!,
        sectionKey: 'labels',
        emptyMessage: messages.labelsEmpty,
        failedMessage: messages.labelsLoadFailed,
        itemBuilder: (label) => LabelTile(label: label),
      ),
    );
  }
}
