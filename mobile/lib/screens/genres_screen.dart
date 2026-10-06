import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/genre_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Every genre the tenant curates, in the tenant's order, each a way into its
/// series.
class GenresScreen extends StatefulWidget {
  const GenresScreen({super.key});

  @override
  State<GenresScreen> createState() => _GenresScreenState();
}

class _GenresScreenState extends State<GenresScreen> {
  CatalogRepository? _catalog;
  List<PublishedGenre>? _genres;
  CatalogFailure? _failure;

  /// Counts the reads started, so an answer to one this screen has stopped
  /// waiting for cannot land.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _load();
  }

  void _load() {
    _genres = null;
    _failure = null;
    unawaited(_read(++_reads, _catalog!));
  }

  Future<void> _read(int read, CatalogRepository catalog) async {
    List<PublishedGenre>? genres;
    CatalogFailure? failure;
    try {
      genres = await catalog.listGenres();
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _genres = genres;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.genresTitle)),
      body: _body(messages),
    );
  }

  Widget _body(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('genres-error'),
        message: catalogFailureCopy(
          messages,
          failure,
          messages.genresLoadFailed,
        ),
        actionKey: const ValueKey('genres-retry'),
        actionLabel: messages.commonRetry,
        onAction: () => setState(_load),
      );
    }
    final genres = _genres;
    if (genres == null) {
      return const Center(
        key: ValueKey('genres-loading'),
        child: CircularProgressIndicator(),
      );
    }
    if (genres.isEmpty) {
      return CatalogMessage(
        key: const ValueKey('genres-empty'),
        message: messages.genresEmpty,
      );
    }
    return _GenreGrid(key: const ValueKey('genres-body'), genres: genres);
  }
}

/// The genres as rows of tiles, read one row at a time as the reader scrolls.
class _GenreGrid extends StatelessWidget {
  const _GenreGrid({super.key, required this.genres});

  final List<PublishedGenre> genres;

  @override
  Widget build(BuildContext context) {
    // Two tiles to a row on a phone, and more as the window widens.
    final columns = columnCount(context, phone: 2, minColumnWidth: 200);
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: rowCount(genres.length, columns),
      separatorBuilder: (context, row) => const SizedBox(height: 24),
      itemBuilder: (context, row) => ColumnRow(
        row: row,
        columns: columns,
        itemCount: genres.length,
        gap: 16,
        itemBuilder: (context, index) => GenreTile(genre: genres[index]),
      ),
    );
  }
}
