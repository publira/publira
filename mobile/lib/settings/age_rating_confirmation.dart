import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';
import 'package:publira/models/series_item.dart';

/// Where the app remembers the age ratings this install has confirmed.
abstract class AgeRatingConfirmationStore {
  /// The stored confirmation, empty when the reader has confirmed none.
  Future<AgeRatingConfirmation> read();

  /// Remembers [rating]. An `r18` already stored is kept rather than lowered
  /// to `r15`; an unrecognized rating is recorded beside that ladder, not on
  /// it.
  Future<AgeRatingConfirmation> write(SeriesAgeRating rating);
}

/// [AgeRatingConfirmationStore] that keeps the confirmation in memory.
///
/// Widget tests inject one so a confirmation does not reach the filesystem,
/// and so a test can start already confirmed or make a write fail.
class MemoryAgeRatingConfirmationStore implements AgeRatingConfirmationStore {
  MemoryAgeRatingConfirmationStore({
    this.confirmed = AgeRatingConfirmation.empty,
    this.writeError,
  });

  AgeRatingConfirmation confirmed;

  /// Thrown by [write], standing in for a disk that refuses the file.
  Object? writeError;

  @override
  Future<AgeRatingConfirmation> read() async => confirmed;

  @override
  Future<AgeRatingConfirmation> write(SeriesAgeRating rating) async {
    final error = writeError;
    if (error != null) {
      throw error;
    }
    confirmed = confirmed.confirming(rating);
    return confirmed;
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
  Future<AgeRatingConfirmation> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) {
        return AgeRatingConfirmation.empty;
      }
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map) {
        return AgeRatingConfirmation.empty;
      }
      return AgeRatingConfirmation(
        named: _parseStoredNamed(decoded['confirmed']),
        unknown: decoded['unknown'] == true,
      );
    } on FileSystemException {
      return AgeRatingConfirmation.empty;
    } on FormatException {
      return AgeRatingConfirmation.empty;
    }
  }

  @override
  Future<AgeRatingConfirmation> write(SeriesAgeRating rating) async {
    final next = (await read()).confirming(rating);
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated file the next read would drop.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(
      jsonEncode({
        if (next.named != null) 'confirmed': next.named!.name,
        if (next.unknown) 'unknown': true,
      }),
    );
    await staged.rename(file.path);
    return next;
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}

SeriesAgeRating? _parseStoredNamed(Object? raw) {
  return switch (raw) {
    'r15' => SeriesAgeRating.r15,
    'r18' => SeriesAgeRating.r18,
    _ => null,
  };
}

/// Holds the ratings this install has confirmed and notifies when they change.
class AgeRatingConfirmationController extends ChangeNotifier {
  AgeRatingConfirmationController({AgeRatingConfirmationStore? store})
    : _store = store ?? MemoryAgeRatingConfirmationStore();

  final AgeRatingConfirmationStore _store;

  var _confirmed = AgeRatingConfirmation.empty;

  /// Whether [restore] has finished. Until it has, a rated series must not
  /// open: the first frame of a returning reader would otherwise show the
  /// body before the stored confirmation is read.
  var isRestored = false;

  AgeRatingConfirmation get confirmed => _confirmed;

  Future<void> restore() async {
    _confirmed = await _store.read();
    isRestored = true;
    notifyListeners();
  }

  /// Records [rating] after it has been persisted, then opens whatever it
  /// covers. A write that fails leaves the previous confirmation in place,
  /// so the body stays behind the prompt.
  Future<void> confirm(SeriesAgeRating rating) async {
    final confirmed = await _store.write(rating);
    _confirmed = confirmed;
    notifyListeners();
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
