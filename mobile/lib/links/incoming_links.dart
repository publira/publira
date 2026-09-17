import 'package:app_links/app_links.dart';

/// Tenant-site URLs the OS hands the app, from a cold start or a tap while
/// it is already running.
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
