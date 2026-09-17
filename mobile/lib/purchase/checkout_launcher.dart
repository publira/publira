import 'package:url_launcher/url_launcher.dart';

/// Opens a checkout page where the reader pays for it.
abstract class CheckoutLauncher {
  /// Whether the page was handed to something that can show it.
  Future<bool> open(Uri url);
}

/// [CheckoutLauncher] backed by the `url_launcher` plugin.
class PluginCheckoutLauncher implements CheckoutLauncher {
  const PluginCheckoutLauncher();

  /// The system browser rather than an in-app web view: the reader types
  /// their card details into a page whose address bar they can see, and the
  /// return to the app is the Universal Link or App Link the browser follows.
  @override
  Future<bool> open(Uri url) =>
      launchUrl(url, mode: LaunchMode.externalApplication);
}
