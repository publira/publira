import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';
import 'package:publira/models/series_item.dart';

/// Where the app remembers the highest age rating this install has confirmed.
abstract class AgeRatingConfirmationStore {
  /// The stored rating, or `null` when the reader has confirmed none.
  Future<SeriesAgeRating?> read();

  /// Remembers [rating], keeping an `r18` already stored rather than lowering
  /// it to `r15`.
  Future<SeriesAgeRating> write(SeriesAgeRating rating);
}

/// [AgeRatingConfirmationStore] that keeps the rating in memory.
///
/// Widget tests inject one so a confirmation does not reach the filesystem,
/// and so a test can start already confirmed.
class MemoryAgeRatingConfirmationStore implements AgeRatingConfirmationStore {
  MemoryAgeRatingConfirmationStore({this.confirmed});

  SeriesAgeRating? confirmed;

  @override
  Future<SeriesAgeRating?> read() async => confirmed;

  @override
  Future<SeriesAgeRating> write(SeriesAgeRating rating) async {
    confirmed = maxRestrictedAgeRating(confirmed, rating);
    return confirmed!;
  }
}

/// Resolves the directory the confirmation file is written under. Injected so
/// a test can point one at a temporary directory instead of the app's own.
typedef SettingsRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [AgeRatingConfirmationStore] as a JSON file in the app's private directory.
///
/// The confirmation is a preference, not a secret, so it lives next to the
/// other files this install keeps rather than in the platform keychain.
class FileAgeRatingConfirmationStore implements AgeRatingConfirmationStore {
  const FileAgeRatingConfirmationStore({
    SettingsRootResolver root = _applicationSupportRoot,
  }) : _root = root;

  static const _fileName = 'age-rating-confirmation.json';

  final SettingsRootResolver _root;

  @override
  Future<SeriesAgeRating?> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) {
        return null;
      }
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map) {
        return null;
      }
      return _parseStored(decoded['confirmed']);
    } on FileSystemException {
      return null;
    } on FormatException {
      return null;
    }
  }

  @override
  Future<SeriesAgeRating> write(SeriesAgeRating rating) async {
    final next = maxRestrictedAgeRating(await read(), rating)!;
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated file the next read would drop.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(jsonEncode({'confirmed': next.name}));
    await staged.rename(file.path);
    return next;
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}

SeriesAgeRating? _parseStored(Object? raw) {
  return switch (raw) {
    'r15' => SeriesAgeRating.r15,
    'r18' => SeriesAgeRating.r18,
    _ => null,
  };
}

/// Holds the rating this install has confirmed and notifies when it changes.
class AgeRatingConfirmationController extends ChangeNotifier {
  AgeRatingConfirmationController({AgeRatingConfirmationStore? store})
    : _store = store ?? MemoryAgeRatingConfirmationStore();

  final AgeRatingConfirmationStore _store;

  SeriesAgeRating? _confirmed;

  /// Whether [restore] has finished. Until it has, a rated series must not
  /// open: the first frame of a returning reader would otherwise show the
  /// body before the stored confirmation is read.
  var isRestored = false;

  SeriesAgeRating? get confirmed => _confirmed;

  Future<void> restore() async {
    _confirmed = await _store.read();
    isRestored = true;
    notifyListeners();
  }

  /// Records [rating] and opens whatever it covers. An `r18` already stored
  /// stays; an `r15` stored later does not take it down.
  Future<void> confirm(SeriesAgeRating rating) async {
    _confirmed = maxRestrictedAgeRating(_confirmed, rating);
    notifyListeners();
    await _store.write(rating);
  }
}

/// Looks up the app's [AgeRatingConfirmationController] and rebuilds its
/// dependents whenever the stored confirmation changes.
class AgeRatingConfirmationScope
    extends InheritedNotifier<AgeRatingConfirmationController> {
  const AgeRatingConfirmationScope({
    super.key,
    required AgeRatingConfirmationController controller,
    required super.child,
  }) : super(notifier: controller);

  static AgeRatingConfirmationController of(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<AgeRatingConfirmationScope>();
    assert(scope != null, 'AgeRatingConfirmationScope not found');
    return scope!.notifier!;
  }
}
