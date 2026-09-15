import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

/// How long the field stays still before the keyword in it is searched for.
///
/// A reader types faster than this between two letters of one word, so a word
/// costs one request rather than one per letter; a reader who has stopped
/// waits about as long as one frame of a page transition.
const _debounce = Duration(milliseconds: 300);

/// How many rows before the end of the results the page under them is asked
/// for, the same read-ahead the catalog list uses.
const _readAheadRows = 5;

/// Search: a keyword, and the published series that match it.
///
/// The field is the app bar, and it is the whole of the screen's input: the
/// results under it answer whatever is in it, one cursor page at a time, and
/// emptying it takes them away rather than searching for nothing. The catalog
/// stands behind this screen, so a reader who cleared the field and changed
/// their mind leaves by going back.
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

  Timer? _pending;

  /// Every page read for [_query] as one list, and `null` while the first is
  /// still in flight.
  List<SeriesItem>? _series;

  /// What the API calls the page under [_series]. Empty at the end of the
  /// results, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole screen, and a later page's,
  /// which is the footer under the rows already on screen.
  CatalogFailure? _failure;
  CatalogFailure? _moreFailure;

  /// Whether a page is in flight. The screen is not built from it — the footer
  /// stands for as long as there is a page left to read — so it is set without
  /// [setState], which is what lets the list ask for a page while it builds.
  var _reading = false;

  CatalogRepository? _catalog;

  /// Counts the reads this screen has started, so an answer to a keyword the
  /// reader has typed past cannot land on the screen under the current one.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _catalog = CatalogScope.of(context);
  }

  @override
  void dispose() {
    _pending?.cancel();
    _field.dispose();
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
    _readFirstPage(query);
  }

  /// Reads the first page of [query], which is also what the retry does after
  /// a failed one: the keyword has not changed, so [_search] would leave it
  /// alone.
  void _readFirstPage(String query) {
    setState(() {
      _query = query;
      _series = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = query.isNotEmpty;
    });
    if (query.isEmpty) {
      // Nothing to ask the API for: the screen is back to its prompt, and an
      // answer to the keyword before this one must not arrive under it.
      _reads++;
      return;
    }
    unawaited(_read(++_reads, _catalog!, query, ''));
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the results ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    unawaited(_read(++_reads, _catalog!, _query, _nextToken));
  }

  /// Reads the page [token] names and puts it under what is already there.
  Future<void> _read(
    int read,
    CatalogRepository catalog,
    String query,
    String token,
  ) async {
    final isFirstPage = token.isEmpty;
    SeriesPage? page;
    CatalogFailure? failure;
    try {
      page = await catalog.searchSeries(query: query, token: token);
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _reading = false;
      if (page == null) {
        if (isFirstPage) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _series = [if (!isFirstPage) ...?_series, ...page.series];
      _nextToken = page.nextToken;
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
          // The API measures the keyword in Unicode code points, and so does
          // the field the site offers for the same search.
          maxLength: searchQueryMaxRunes,
          decoration: InputDecoration(
            border: InputBorder.none,
            // The field is the title of the app bar, which has no room under
            // it for the count of a limit a reader will not reach.
            counterText: '',
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
    final failure = _failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('search-error'),
        message: catalogFailureCopy(messages, failure, messages.searchFailed),
        actionKey: const ValueKey('search-retry'),
        actionLabel: messages.commonRetry,
        onAction: () {
          _pending?.cancel();
          _readFirstPage(_query);
        },
      );
    }
    final series = _series;
    if (series == null) {
      return const Padding(
        key: ValueKey('search-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    // The footer is the page under the list: a spinner while there is one left
    // to read, and what went wrong when the last attempt at it failed.
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    if (series.isEmpty && !hasFooter) {
      return CatalogMessage(
        key: const ValueKey('search-empty'),
        message: messages.searchNoResults(query: _query),
      );
    }
    return ListView.separated(
      key: const ValueKey('search-results'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: series.length + (hasFooter ? 1 : 0),
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index >= series.length - _readAheadRows) {
          _readMore();
        }
        if (index == series.length) {
          return _SearchPageFooter(
            message: _moreFailure == null
                ? null
                : catalogFailureCopy(
                    messages,
                    _moreFailure,
                    messages.searchFailed,
                  ),
            onRetry: () {
              setState(() {
                _moreFailure = null;
              });
              _readMore();
            },
          );
        }
        return SeriesTile(series: series[index]);
      },
    );
  }
}

/// The page under the results, at the bottom of them: a spinner while that
/// page is being read, and what went wrong when it could not be.
class _SearchPageFooter extends StatelessWidget {
  const _SearchPageFooter({required this.message, required this.onRetry});

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = this.message;
    if (message == null) {
      return const Padding(
        key: ValueKey('search-more-loading'),
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: RetryRow(
        sectionKey: 'search-more',
        message: message,
        onRetry: onRetry,
      ),
    );
  }
}
