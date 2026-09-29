import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Where the app remembers the pinned announcement whose banner the reader
/// closed.
///
/// It holds one id rather than a list, as the site's cookie does: only the
/// newest pinned announcement is ever shown, so pinning another one stops the
/// stored id from matching and the banner comes back.
abstract class DismissedAnnouncementStore {
  /// The stored id, empty when the reader has closed no banner.
  Future<String> read();

  Future<void> write(String announcementId);
}

/// [DismissedAnnouncementStore] that keeps the id in memory, which widget
/// tests inject so a closed banner does not reach the filesystem.
class MemoryDismissedAnnouncementStore implements DismissedAnnouncementStore {
  MemoryDismissedAnnouncementStore({this.announcementId = ''});

  String announcementId;

  @override
  Future<String> read() async => announcementId;

  @override
  Future<void> write(String announcementId) async {
    this.announcementId = announcementId;
  }
}

/// Resolves the directory the file is written under. Injected so a test can
/// point one at a temporary directory instead of the app's own.
typedef DismissedAnnouncementRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [DismissedAnnouncementStore] as a file in the app's private directory.
///
/// The device rather than the account carries it, so a reader who never
/// signed in can close the banner too.
class FileDismissedAnnouncementStore implements DismissedAnnouncementStore {
  const FileDismissedAnnouncementStore({this._root = _applicationSupportRoot});

  static const _fileName = 'dismissed-announcement';

  final DismissedAnnouncementRootResolver _root;

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
  Future<void> write(String announcementId) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated id behind.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(announcementId);
    await staged.rename(file.path);
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}
