import 'package:share_plus/share_plus.dart';

/// The platform share sheet a series or an episode is handed to.
abstract class ShareSheet {
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
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
}
