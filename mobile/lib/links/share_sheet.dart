import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// The platform share sheet a series or an episode is handed to, and a file
/// the app writes for the reader to keep.
abstract class ShareSheet {
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
  });

  /// Hands [text] alone to the share sheet, for the reader to keep somewhere
  /// of their choosing rather than send as a link.
  Future<void> shareText({required String text, required String title});

  /// Hands [bytes] to the share sheet as one file called [name], of the media
  /// type [mimeType], for the reader to save or send on.
  Future<void> shareFile({
    required Uint8List bytes,
    required String name,
    required String mimeType,
    required String title,
  });

  /// Writes [bytes], as they arrive, into one file called [name], of the media
  /// type [mimeType], and hands it to the share sheet once the last piece is
  /// written, so a download of any size is never held in memory whole.
  ///
  /// A failure of [bytes] fails the call before the sheet opens, and leaves no
  /// file behind.
  Future<void> shareFileStream({
    required Stream<List<int>> bytes,
    required String name,
    required String mimeType,
    required String title,
  });
}

/// Resolves the app's cache, which [PluginShareSheet.shareFileStream] writes
/// into. Injected so a test can point one at a temporary directory instead.
typedef ShareCacheResolver = Future<Directory> Function();

/// Opens the platform share sheet on [params]. Injected so a test can stand in
/// for the plugin.
typedef SharePresenter = Future<void> Function(ShareParams params);

Future<void> _presentWithPlugin(ShareParams params) =>
    SharePlus.instance.share(params);

/// [ShareSheet] backed by the `share_plus` plugin.
class PluginShareSheet implements ShareSheet {
  const PluginShareSheet({
    this._cache = getTemporaryDirectory,
    this._present = _presentWithPlugin,
  });

  final ShareCacheResolver _cache;
  final SharePresenter _present;

  /// The directory of the app's cache [shareFileStream] writes into.
  static const _streamedDirectoryName = 'shared-files';

  /// The directories of the [shareFileStream] calls still writing or sharing,
  /// which a call starting meanwhile leaves alone. A screen that hands over a
  /// download can be disposed while it is under way and offer another, and
  /// the two must not remove or overwrite each other's file.
  static final _inUse = <String>{};
  static var _calls = 0;

  @override
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
  }) {
    // The plugin will not take a URI and a message together, so the canonical
    // address rides in the text a recipient pastes, under the wording the
    // catalog wrote for this work.
    return _present(
      ShareParams(text: '$text\n$url', title: title, subject: title),
    );
  }

  @override
  Future<void> shareText({required String text, required String title}) =>
      _present(ShareParams(text: text, title: title, subject: title));

  @override
  Future<void> shareFile({
    required Uint8List bytes,
    required String name,
    required String mimeType,
    required String title,
  }) {
    // The plugin writes data it is handed into the temporary directory under
    // a name of its own unless one is given here; the file's own name is read
    // on the web only.
    return _present(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: mimeType, name: name)],
        fileNameOverrides: [name],
        title: title,
        subject: title,
      ),
    );
  }

  @override
  Future<void> shareFileStream({
    required Stream<List<int>> bytes,
    required String name,
    required String mimeType,
    required String title,
  }) async {
    final root = Directory('${(await _cache()).path}/$_streamedDirectoryName');
    // Named, and claimed, before anything is created or removed, so no call
    // can take this one's directory for one left behind.
    final directory = Directory(
      '${root.path}/${DateTime.now().microsecondsSinceEpoch}-${_calls++}',
    );
    _inUse.add(directory.path);
    try {
      // Only the files of the calls still under way and of the one shared last
      // are kept. The app the reader picks may still be reading a file after
      // the sheet has closed, so it cannot be removed then, and an older one is
      // a copy the reader has already saved or sent on.
      if (await root.exists()) {
        await for (final entry in root.list()) {
          if (!_inUse.contains(entry.path)) {
            await entry.delete(recursive: true);
          }
        }
      }
      await directory.create(recursive: true);
      final file = File('${directory.path}/$name');
      final sink = file.openWrite();
      try {
        await sink.addStream(bytes);
        await sink.close();
      } on Object {
        try {
          await sink.close();
        } on FileSystemException {
          // The file is removed with its directory all the same.
        }
        await directory.delete(recursive: true);
        rethrow;
      }
      await _present(
        ShareParams(
          files: [XFile(file.path, mimeType: mimeType, name: name)],
          title: title,
          subject: title,
        ),
      );
    } finally {
      _inUse.remove(directory.path);
    }
  }
}
