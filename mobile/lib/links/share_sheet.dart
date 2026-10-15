import 'dart:typed_data';

import 'package:share_plus/share_plus.dart';

/// The platform share sheet a series or an episode is handed to, and a file
/// the app writes for the reader to keep.
abstract class ShareSheet {
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
  });

  /// Hands [bytes] to the share sheet as one file called [name], of the media
  /// type [mimeType], for the reader to save or send on.
  Future<void> shareFile({
    required Uint8List bytes,
    required String name,
    required String mimeType,
    required String title,
  });
}

/// [ShareSheet] backed by the `share_plus` plugin.
class PluginShareSheet implements ShareSheet {
  const PluginShareSheet();

  @override
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
  }) {
    // The plugin will not take a URI and a message together, so the canonical
    // address rides in the text a recipient pastes, under the wording the
    // catalog wrote for this work.
    return SharePlus.instance.share(
      ShareParams(text: '$text\n$url', title: title, subject: title),
    );
  }

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
    return SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: mimeType, name: name)],
        fileNameOverrides: [name],
        title: title,
        subject: title,
      ),
    );
  }
}
