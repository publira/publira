import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/creator_tile.dart';
import 'package:publira/catalog/label_tile.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/catalog/series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_item.dart';

/// How long the field stays still before the keyword in it is searched for.
///
/// A reader types faster than this between two letters of one word, so a word
/// costs one request per group rather than one per letter; a reader who has
/// stopped waits about as long as one frame of a page transition.
const _debounce = Duration(milliseconds: 300);

/// How many rows of each group the overview shows before offering the rest,
/// the number the site's overview shows.
const _overviewRows = 5;

/// The groups one keyword answers with, each a list of its own.
enum _SearchGroup { series, creators, labels }

/// Search: a keyword, and the published series, authors, and labels that
/// match it.
///
/// The field is the app bar, and it is the whole of the screen's input: the
/// results under it answer whatever is in it, and emptying it takes them away
/// rather than searching for nothing. The catalog stands behind this screen,
/// so a reader who cleared the field and changed their mind leaves by going
/// back.
///
/// Every group is read on its own, so an author a keyword names arrives
/// whether or not a series matched, and one group the API could not answer
/// offers its retry without taking the others down. The overview shows the
/// first rows of all three; a group opened on its own is its whole list, one
/// cursor page at a time, and keeps what the overview already read.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _field = TextEditingController();

  /// The keyword the rows on screen answer. Empty is the prompt: a reader who
  /// has typed nothing is asked for a keyword rather than told there are no
  /// results.
  var _query = '';

  /// The group shown on its own, and `null` for the overview of all three.
  _SearchGroup? _group;

  Timer? _pending;

  final _series = CatalogPager<SeriesItem, Null>(_nothingAsked);
  final _creators = CatalogPager<PublishedCreator, Null>(_nothingAsked);
  final _labels = CatalogPager<PublishedLabel, Null>(_nothingAsked);

  CatalogRepository? _catalog;

  /// Asks the keyword again whenever the repository changes, the way the
  /// catalog list does: the rows on screen and the tokens under them were
  /// answered by the repository that has just been replaced, so keeping them
  /// would show one catalog's results and then page them out of another.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    final swapped = _catalog != null;
    _catalog = catalog;
    if (swapped && _query.isNotEmpty) {
      _readFirstPages(_query);
    }
  }

  @override
  void dispose() {
    _pending?.cancel();
    _field.dispose();
    _series.dispose();
    _creators.dispose();
    _labels.dispose();
    super.dispose();
  }

  /// Waits for the field to stand still before searching for what is in it.
  ///
  /// A keyword that has not changed is left alone, so returning to the same
  /// text — a letter typed and deleted again — keeps the rows that are already
  /// answering it.
  void _onChanged(String value) {
    _pending?.cancel();
    _pending = Timer(_debounce, () => _search(value));
  }

  /// Searches for [value] now, which is what the keyboard's search key does.
  void _submit(String value) {
    _pending?.cancel();
    _search(value);
  }

  void _search(String value) {
    final query = value.trim();
    if (query == _query) {
      return;
    }
    _readFirstPages(query);
  }

  /// Reads the first page of every group for [query].
  ///
  /// A token belongs to the keyword it was built for, so each group's reader
  /// holds the keyword it was started with rather than whatever the field says
  /// by the time a later page is asked for.
  void _readFirstPages(String query) {
    setState(() {
      _query = query;
    });
    if (query.isEmpty) {
      // Nothing to ask the API for: the screen is back to its prompt, and an
      // answer to the keyword before this one must not arrive under it.
      _series.clear();
      _creators.clear();
      _labels.clear();
      return;
    }
    final catalog = _catalog!;
    _series.restart((token) async {
      final page = await catalog.searchSeries(query: query, token: token);
      return CatalogPageRead(items: page.series, nextToken: page.nextToken);
    });
    _creators.restart((token) async {
      final page = await catalog.searchCreators(query: query, token: token);
      return CatalogPageRead(items: page.creators, nextToken: page.nextToken);
    });
    _labels.restart((token) async {
      final page = await catalog.searchLabels(query: query, token: token);
      return CatalogPageRead(items: page.labels, nextToken: page.nextToken);
    });
  }

  void _show(_SearchGroup? group) {
    setState(() {
      _group = group;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          key: const ValueKey('search-field'),
          autofocus: true,
          controller: _field,
          textInputAction: TextInputAction.search,
          inputFormatters: const [_RuneLimitingFormatter(searchQueryMaxRunes)],
          decoration: InputDecoration(
            border: InputBorder.none,
            hintText: messages.searchLabel,
          ),
          onChanged: _onChanged,
          onSubmitted: _submit,
        ),
        actions: [
          // An empty field has nothing to clear, so the button is there
          // exactly while there is a keyword to take away.
          ListenableBuilder(
            listenable: _field,
            builder: (context, child) => _field.text.isEmpty
                ? const SizedBox.shrink()
                : IconButton(
                    key: const ValueKey('search-clear'),
                    icon: const Icon(Icons.clear),
                    tooltip: messages.searchClear,
                    onPressed: () {
                      _field.clear();
                      _submit('');
                    },
                  ),
          ),
        ],
        bottom: _query.isEmpty
            ? null
            : _GroupChoice(group: _group, onSelected: _show),
      ),
      body: _results(messages),
    );
  }

  Widget _results(AppMessages messages) {
    if (_query.isEmpty) {
      return CatalogMessage(
        key: const ValueKey('search-prompt'),
        message: messages.searchPrompt,
      );
    }
    return switch (_group) {
      null => ListView(
        key: const ValueKey('search-overview'),
        padding: const EdgeInsets.only(bottom: 16),
        children: [
          _OverviewSection(
            pager: _series,
            name: 'series',
            heading: messages.searchSeriesHeading,
            emptyMessage: messages.searchSeriesNoResults(query: _query),
            failedMessage: messages.searchSeriesFailed,
            showAllLabel: messages.searchSeriesShowAll,
            onShowAll: () => _show(_SearchGroup.series),
            itemBuilder: (series) => SeriesTile(series: series),
          ),
          _OverviewSection(
            pager: _creators,
            name: 'creators',
            heading: messages.searchCreatorsHeading,
            emptyMessage: messages.searchCreatorsNoResults(query: _query),
            failedMessage: messages.searchCreatorsFailed,
            showAllLabel: messages.searchCreatorsShowAll,
            onShowAll: () => _show(_SearchGroup.creators),
            itemBuilder: (creator) => CreatorTile(creator: creator),
          ),
          _OverviewSection(
            pager: _labels,
            name: 'labels',
            heading: messages.searchLabelsHeading,
            emptyMessage: messages.searchLabelsNoResults(query: _query),
            failedMessage: messages.searchLabelsFailed,
            showAllLabel: messages.searchLabelsShowAll,
            onShowAll: () => _show(_SearchGroup.labels),
            itemBuilder: (label) => LabelTile(label: label),
          ),
        ],
      ),
      _SearchGroup.series => _GroupResults(
        pager: _series,
        name: 'series',
        emptyMessage: messages.searchSeriesNoResults(query: _query),
        failedMessage: messages.searchSeriesFailed,
        itemBuilder: (series) => SeriesTile(series: series),
      ),
      _SearchGroup.creators => _GroupResults(
        pager: _creators,
        name: 'creators',
        emptyMessage: messages.searchCreatorsNoResults(query: _query),
        failedMessage: messages.searchCreatorsFailed,
        itemBuilder: (creator) => CreatorTile(creator: creator),
      ),
      _SearchGroup.labels => _GroupResults(
        pager: _labels,
        name: 'labels',
        emptyMessage: messages.searchLabelsNoResults(query: _query),
        failedMessage: messages.searchLabelsFailed,
        itemBuilder: (label) => LabelTile(label: label),
      ),
    };
  }
}

/// The reader a group holds before any keyword has been typed, which is never
/// called: a pager reads only once it is restarted with a keyword's reader.
Future<CatalogPageRead<T, Null>?> _nothingAsked<T>(String token) async => null;

/// Which of the groups the screen shows: all of them, or one on its own.
class _GroupChoice extends StatelessWidget implements PreferredSizeWidget {
  const _GroupChoice({required this.group, required this.onSelected});

  final _SearchGroup? group;
  final ValueChanged<_SearchGroup?> onSelected;

  static const _height = 48.0;

  @override
  Size get preferredSize => const Size.fromHeight(_height);

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return SizedBox(
      height: _height,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        children: [
          ChoiceChip(
            key: const ValueKey('search-show-overview'),
            label: Text(messages.searchAll),
            selected: group == null,
            onSelected: (_) => onSelected(null),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            key: const ValueKey('search-show-series'),
            label: Text(messages.searchSeriesHeading),
            selected: group == _SearchGroup.series,
            onSelected: (_) => onSelected(_SearchGroup.series),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            key: const ValueKey('search-show-creators'),
            label: Text(messages.searchCreatorsHeading),
            selected: group == _SearchGroup.creators,
            onSelected: (_) => onSelected(_SearchGroup.creators),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            key: const ValueKey('search-show-labels'),
            label: Text(messages.searchLabelsHeading),
            selected: group == _SearchGroup.labels,
            onSelected: (_) => onSelected(_SearchGroup.labels),
          ),
        ],
      ),
    );
  }
}

/// One group in the overview: its heading, its first rows, and the way to the
/// rest of it.
///
/// The offer of the rest is there only while there is more than the overview
/// shows, because one leading to the rows already on screen is a dead end.
class _OverviewSection<T> extends StatelessWidget {
  const _OverviewSection({
    required this.pager,
    required this.name,
    required this.heading,
    required this.emptyMessage,
    required this.failedMessage,
    required this.showAllLabel,
    required this.onShowAll,
    required this.itemBuilder,
  });

  final CatalogPager<T, Null> pager;

  /// Names the group on screen, as `search-<name>-…`.
  final String name;

  final String heading;
  final String emptyMessage;

  /// What the group calls a failure of its own.
  final String failedMessage;

  final String showAllLabel;
  final VoidCallback onShowAll;
  final Widget Function(T item) itemBuilder;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final items = pager.items;
        final failure = pager.failure;
        return Column(
          key: ValueKey('search-$name'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(heading, style: theme.textTheme.titleMedium),
            ),
            if (failure != null)
              RetryRow(
                sectionKey: 'search-$name',
                message: catalogFailureCopy(messages, failure, failedMessage),
                onRetry: pager.restart,
              )
            else if (items == null)
              Padding(
                key: ValueKey('search-$name-loading'),
                padding: const EdgeInsets.all(16),
                child: const Center(child: CircularProgressIndicator()),
              )
            else if (items.isEmpty && pager.nextToken.isEmpty)
              Padding(
                key: ValueKey('search-$name-empty'),
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(emptyMessage),
              )
            else ...[
              for (final item in items.take(_overviewRows)) itemBuilder(item),
              if (items.length > _overviewRows || pager.nextToken.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: TextButton(
                    key: ValueKey('search-$name-show-all'),
                    onPressed: onShowAll,
                    child: Text(showAllLabel),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}

/// One group on its own: every row read so far, and the page under them asked
/// for as the reader nears the end.
class _GroupResults<T> extends StatelessWidget {
  const _GroupResults({
    required this.pager,
    required this.name,
    required this.emptyMessage,
    required this.failedMessage,
    required this.itemBuilder,
  });

  final CatalogPager<T, Null> pager;

  /// Names the group on screen, as `search-<name>-…`.
  final String name;

  final String emptyMessage;

  /// What the group calls a failure of its own.
  final String failedMessage;

  final Widget Function(T item) itemBuilder;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final failure = pager.failure;
        if (failure != null) {
          return CatalogMessage(
            key: ValueKey('search-$name-error'),
            message: catalogFailureCopy(messages, failure, failedMessage),
            actionKey: ValueKey('search-$name-retry'),
            actionLabel: messages.commonRetry,
            onAction: pager.restart,
          );
        }
        final items = pager.items;
        if (items == null) {
          return Padding(
            key: ValueKey('search-$name-loading'),
            padding: const EdgeInsets.all(24),
            child: const Center(child: CircularProgressIndicator()),
          );
        }
        final hasFooter = pager.hasFooter;
        if (items.isEmpty && !hasFooter) {
          return CatalogMessage(
            key: ValueKey('search-$name-empty'),
            message: emptyMessage,
          );
        }
        return ListView.separated(
          key: ValueKey('search-$name-results'),
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: items.length + (hasFooter ? 1 : 0),
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= items.length - readAheadRows) {
              pager.readMore();
            }
            if (index == items.length) {
              return PageFooter(
                sectionKey: 'search-$name-more',
                message: pager.moreFailure == null
                    ? null
                    : catalogFailureCopy(
                        messages,
                        pager.moreFailure,
                        failedMessage,
                      ),
                onRetry: pager.retryMore,
              );
            }
            return itemBuilder(items[index]);
          },
        );
      },
    );
  }
}

/// Keeps the field inside the code-point limit the API measures a keyword by.
///
/// [TextField.maxLength] counts grapheme clusters, of which one can be several
/// code points — 👍🏽 is one character and two — so a field limited by it still
/// holds keywords the search RPCs refuse. Text over the limit is cut rather
/// than refused, so pasting a long line leaves the reader with the part that
/// fits instead of with nothing.
class _RuneLimitingFormatter extends TextInputFormatter {
  const _RuneLimitingFormatter(this.maxRunes);

  final int maxRunes;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final runes = newValue.text.runes.toList();
    if (runes.length <= maxRunes) {
      return newValue;
    }
    final text = String.fromCharCodes(runes.take(maxRunes));
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}
