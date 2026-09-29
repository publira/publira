import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// The anonymous identifier the API hands a signed-out reader, which the
/// storefront keeps in its `publira_aid` cookie, and when that cookie expires.
class AnonymousId {
  const AnonymousId({required this.value, required this.expiresAt});

  final String value;
  final DateTime expiresAt;

  bool isLiveAt(DateTime now) => now.isBefore(expiresAt);
}

/// Where the app keeps the [AnonymousId].
///
/// Sending it back is what makes a signed-out reader one actor across views;
/// without it every view would count as a reader of its own.
abstract class AnonymousIdStore {
  /// The stored identifier, `null` before the API has handed one over.
  Future<AnonymousId?> read();

  Future<void> write(AnonymousId anonymousId);
}

/// [AnonymousIdStore] that keeps the identifier in memory, which widget tests
/// inject so it does not reach the filesystem.
class MemoryAnonymousIdStore implements AnonymousIdStore {
  MemoryAnonymousIdStore({this.anonymousId});

  AnonymousId? anonymousId;

  @override
  Future<AnonymousId?> read() async => anonymousId;

  @override
  Future<void> write(AnonymousId anonymousId) async {
    this.anonymousId = anonymousId;
  }
}

/// Resolves the directory the file is written under. Injected so a test can
/// point one at a temporary directory instead of the app's own.
typedef AnonymousIdRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [AnonymousIdStore] as a JSON file in the app's private directory.
class FileAnonymousIdStore implements AnonymousIdStore {
  const FileAnonymousIdStore({this._root = _applicationSupportRoot});

  static const _fileName = 'anonymous-id.json';

  final AnonymousIdRootResolver _root;

  @override
  Future<AnonymousId?> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) {
        return null;
      }
      final json = jsonDecode(await file.readAsString());
      if (json is! Map) {
        return null;
      }
      final value = json['value'];
      final expiresAt = DateTime.tryParse('${json['expiresAt']}');
      if (value is! String || value.isEmpty || expiresAt == null) {
        return null;
      }
      return AnonymousId(value: value, expiresAt: expiresAt);
    } on FileSystemException {
      return null;
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(AnonymousId anonymousId) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated identifier behind.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(
      jsonEncode({
        'value': anonymousId.value,
        'expiresAt': anonymousId.expiresAt.toUtc().toIso8601String(),
      }),
    );
    await staged.rename(file.path);
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}
