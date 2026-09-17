import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:publira/catalog/catalog_failure.dart';

/// One cursor page as a [CatalogPager] reads it.
class CatalogPageRead<T, H> {
  const CatalogPageRead({
    required this.items,
    this.nextToken = '',
    this.header,
  });

  final List<T> items;

  /// What the API calls the page after this one. Empty at the end of it.
  final String nextToken;

  /// What the response says about the list itself, such as the author a list
  /// of series is credited to. Only the first page's is kept.
  final H? header;
}

/// Reads the page [token] names, empty for the first. `null` is the API
/// answering that what the list belongs to does not exist.
typedef CatalogPageReader<T, H> =
    Future<CatalogPageRead<T, H>?> Function(String token);

/// Every page of one cursor-paged list read so far, as one list that grows as
/// the reader nears the end of it.
///
/// A screen builds from it inside a [ListenableBuilder]. [readMore] is called
/// from the row builder and changes nothing a build reads until its page
/// arrives, which is what lets the list ask for a page while it builds.
class CatalogPager<T, H> extends ChangeNotifier {
  CatalogPager(this._reader);

  CatalogPageReader<T, H> _reader;

  /// Every row read so far, and `null` while the first page is in flight or
  /// nothing has been asked for.
  List<T>? get items => _items;
  List<T>? _items;

  /// The first page's [CatalogPageRead.header].
  H? get header => _header;
  H? _header;

  /// Whether the API answered that what the list belongs to does not exist.
  bool get notFound => _notFound;
  var _notFound = false;

  /// What the API calls the page under [items]. Empty at the end of the list.
  String get nextToken => _nextToken;
  var _nextToken = '';

  /// The first page's failure, which is the whole list.
  CatalogFailure? get failure => _failure;
  CatalogFailure? _failure;

  /// A later page's failure, which is the footer under the rows already read.
  CatalogFailure? get moreFailure => _moreFailure;
  CatalogFailure? _moreFailure;

  /// Whether a footer stands under [items]: a page left to read, or the last
  /// attempt at one having failed.
  bool get hasFooter => _nextToken.isNotEmpty || _moreFailure != null;

  var _reading = false;

  /// Counts the reads started, so an answer to one this pager has stopped
  /// waiting for — a changed keyword, a swapped repository — cannot land.
  var _reads = 0;

  var _disposed = false;

  /// Reads the first page again, through [reader] when one is given, and drops
  /// every row read before.
  void restart([CatalogPageReader<T, H>? reader]) {
    if (reader != null) {
      _reader = reader;
    }
    _reset();
    _reading = true;
    notifyListeners();
    unawaited(_read(++_reads, ''));
  }

  /// Drops every row and stops waiting for the page in flight, which leaves
  /// the pager holding nothing until it is restarted.
  void clear() {
    _reset();
    _reads++;
    notifyListeners();
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the list ended, or the last attempt at it failed and waits on
  /// [retryMore].
  void readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    unawaited(_read(++_reads, _nextToken));
  }

  /// Asks again for the page whose read failed.
  void retryMore() {
    _moreFailure = null;
    notifyListeners();
    readMore();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _reset() {
    _items = null;
    _header = null;
    _notFound = false;
    _nextToken = '';
    _failure = null;
    _moreFailure = null;
    _reading = false;
  }

  Future<void> _read(int read, String token) async {
    final isFirstPage = token.isEmpty;
    CatalogPageRead<T, H>? page;
    CatalogFailure? failure;
    try {
      page = await _reader(token);
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (_disposed || read != _reads) {
      return;
    }
    _reading = false;
    if (failure != null) {
      if (isFirstPage) {
        _failure = failure;
      } else {
        _moreFailure = failure;
      }
    } else if (page == null) {
      _notFound = true;
    } else {
      if (isFirstPage) {
        _header = page.header;
      }
      _items = [if (!isFirstPage) ...?_items, ...page.items];
      _nextToken = page.nextToken;
    }
    notifyListeners();
  }
}
