import 'package:app_links/app_links.dart';

/// Tenant-site URLs the OS hands the app, from a cold start or a tap while
/// it is already running.
///
/// A link to a series, an episode, the announcements, a checkout return, an
/// email confirmation, a password reset, or an email change on the tenant
/// host opens the app when it is installed, rather than the browser. iOS
/// claims the manifest's `tenant.host` through
/// `com.apple.developer.associated-domains`, from the generated
/// `PUBLIRA_ASSOCIATED_DOMAIN` build setting, as `applinks:` for the links and
/// `webcredentials:` for the site's passkeys (`PasskeyAuthenticator`).
/// Android claims the same host as an App Link (`autoVerify`) for
/// `/series/…`, `/announcements`, `/checkout/return`, `/verify`,
/// `/reset-password`, `/confirm-password`, and `/confirm-email`, including a
/// locale prefix. `assetlinks.json` and `apple-app-site-association` are
/// served by the public site from tenant configuration, not by this app.
///
/// Flutter's own deep linking is off, because the raw `https://…` location
/// would match none of the router's paths; `appLocationFor` turns each URL
/// into one instead.
abstract class IncomingLinks {
  /// The URL that opened a terminated app, or `null` when it was opened
  /// from the launcher.
  Future<Uri?> get initial;

  /// URLs that arrive while the app is already running.
  Stream<Uri> get changes;
}

/// [IncomingLinks] backed by the `app_links` plugin.
class PluginIncomingLinks implements IncomingLinks {
  PluginIncomingLinks([AppLinks? plugin]) : _plugin = plugin ?? AppLinks();

  final AppLinks _plugin;

  @override
  Future<Uri?> get initial => _plugin.getInitialLink();

  @override
  Stream<Uri> get changes => _plugin.uriLinkStream;
}
