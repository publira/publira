import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Where the app keeps the anonymous identifier the API hands a signed-out
/// reader, which the storefront keeps in its `publira_aid` cookie.
///
/// Sending it back is what makes a signed-out reader one actor across views;
/// without it every view would count as a reader of its own.
abstract class AnonymousIdStore {
  /// The stored identifier, empty before the API has handed one over.
  Future<String> read();

  Future<void> write(String anonymousId);
}

/// [AnonymousIdStore] that keeps the identifier in memory, which widget tests
/// inject so it does not reach the filesystem.
class MemoryAnonymousIdStore implements AnonymousIdStore {
  MemoryAnonymousIdStore({this.anonymousId = ''});

  String anonymousId;

  @override
  Future<String> read() async => anonymousId;

  @override
  Future<void> write(String anonymousId) async {
    this.anonymousId = anonymousId;
  }
}

/// Resolves the directory the file is written under. Injected so a test can
/// point one at a temporary directory instead of the app's own.
typedef AnonymousIdRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [AnonymousIdStore] as a file in the app's private directory.
class FileAnonymousIdStore implements AnonymousIdStore {
  const FileAnonymousIdStore({this._root = _applicationSupportRoot});

  static const _fileName = 'anonymous-id';

  final AnonymousIdRootResolver _root;

  @override
  Future<String> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) {
        return '';
      }
      return (await file.readAsString()).trim();
    } on FileSystemException {
      return '';
    }
  }

  @override
  Future<void> write(String anonymousId) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated identifier behind.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(anonymousId);
    await staged.rename(file.path);
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}
