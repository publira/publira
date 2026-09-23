import 'package:url_launcher/url_launcher.dart';

/// The system browser, which a page on another site is handed to.
abstract class ExternalBrowser {
  /// Whether [url] was handed to something that can show it.
  Future<bool> open(Uri url);
}

/// [ExternalBrowser] backed by the `url_launcher` plugin.
class PluginExternalBrowser implements ExternalBrowser {
  const PluginExternalBrowser();

  @override
  Future<bool> open(Uri url) =>
      launchUrl(url, mode: LaunchMode.externalApplication);
}
