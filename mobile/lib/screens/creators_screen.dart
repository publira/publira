import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/creator_tile.dart';
import 'package:publira/catalog/paged_list.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Every author credited on a published series, by name, one cursor page at a
/// time, each a way into the author's screen.
class CreatorsScreen extends StatefulWidget {
  const CreatorsScreen({super.key});

  @override
  State<CreatorsScreen> createState() => _CreatorsScreenState();
}

class _CreatorsScreenState extends State<CreatorsScreen> {
  CatalogRepository? _catalog;
  CatalogPager<PublishedCreator, Null>? _pager;

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
    Future<CatalogPageRead<PublishedCreator, Null>> read(String token) async {
      final page = await catalog.listCreators(token: token);
      return CatalogPageRead(items: page.creators, nextToken: page.nextToken);
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
      appBar: AppBar(title: AutospacedText(messages.creatorsTitle)),
      body: PagedList(
        pager: _pager!,
        sectionKey: 'creators',
        emptyMessage: messages.creatorsEmpty,
        failedMessage: messages.creatorsLoadFailed,
        itemBuilder: (creator) => CreatorTile(creator: creator),
      ),
    );
  }
}
