import 'package:flutter/foundation.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';

/// The tenant site a share names and an incoming link is accepted from.
///
/// A build is pinned to one host. The public origin is always `https`, which
/// is the address Universal Links and App Links claim; a share of a local
/// stack still hands that form over rather than an http loopback nobody else
/// can open.
@immutable
class PublicSite {
  const PublicSite({required this.host, this.defaultLocale});

  /// Host of `GetTenantByDomain`, without a scheme.
  final String host;

  /// The tenant's default locale code, or `null` until the lookup has
  /// answered. An unknown default is treated as the unprefixed path, which
  /// is always a valid public URL.
  final String? defaultLocale;

  /// Canonical address of an in-app [path] as a reader of [locale] would see
  /// it on the site: the tenant's default locale has no prefix, and every
  /// other catalog does.
  Uri uriFor(String path, {required String locale}) {
    final prefixed = withLocalePrefix(
      path,
      locale: locale,
      defaultLocale: defaultLocale,
    );
    return Uri.parse('https://$host$prefixed');
  }

  @override
  bool operator ==(Object other) {
    return other is PublicSite &&
        other.host == host &&
        other.defaultLocale == defaultLocale;
  }

  @override
  int get hashCode => Object.hash(host, defaultLocale);
}

/// In-app location for a tenant-site [uri], or `null` when it is not one
/// this app opens.
///
/// The host must be [tenantHost]. A locale prefix the catalogs know is
/// stripped, so `/en/series/SR01` and `/series/SR01` are the same series.
/// Query strings ride along, which is how a checkout return still names the
/// episode it was started for and a confirmation or reset link still carries
/// its token.
String? appLocationFor(Uri uri, {required String tenantHost}) {
  if (uri.scheme != 'https' && uri.scheme != 'http') {
    return null;
  }
  if (!_hostMatches(uri.host, tenantHost)) {
    return null;
  }
  final path = stripLocalePrefix(uri.path);
  if (!_isOpenablePath(path)) {
    return null;
  }
  if (!uri.hasQuery) {
    return path;
  }
  return Uri(path: path, query: uri.query).toString();
}

/// Public pathname for an in-app [path] in [locale].
///
/// Matches the site: the tenant's default locale is unprefixed, and a
/// catalog the tenant does not default to carries its code in front.
String withLocalePrefix(
  String path, {
  required String locale,
  String? defaultLocale,
}) {
  final normalized = _normalizePath(path);
  final code = locale.trim();
  if (code.isEmpty) {
    return normalized;
  }
  if (defaultLocale == null ||
      code.toLowerCase() == defaultLocale.trim().toLowerCase()) {
    return normalized;
  }
  return normalized == '/' ? '/$code' : '/$code$normalized';
}

/// [pathname] with a leading locale segment the catalogs know removed.
String stripLocalePrefix(String pathname) {
  final segments = _segments(pathname);
  if (segments.isEmpty) {
    return '/';
  }
  if (supportedLocaleForCode(segments.first) == null) {
    return _join(segments);
  }
  return _join(segments.sublist(1));
}

bool _hostMatches(String incomingHost, String tenantHost) {
  final configured = tenantHost.trim().toLowerCase();
  if (configured.isEmpty) {
    return false;
  }
  final configuredHost = configured.split(':').first;
  return incomingHost.toLowerCase() == configuredHost;
}

bool _isOpenablePath(String path) {
  final segments = _segments(path);
  if (segments.length == 2 &&
      segments[0] == 'checkout' &&
      segments[1] == 'return') {
    return true;
  }
  // The account mails' links: a confirmation, a password reset request, the
  // reset link itself, and either link of an email change. A token rides
  // along in the query, which `appLocationFor` keeps.
  if (segments.length == 1 &&
      const {
        'verify',
        'reset-password',
        'confirm-password',
        'confirm-email',
      }.contains(segments[0])) {
    return true;
  }
  if (segments.length >= 2 &&
      segments[0] == 'series' &&
      segments[1].isNotEmpty) {
    if (segments.length == 2) {
      return true;
    }
    if (segments.length >= 4 &&
        segments[2] == 'episodes' &&
        segments[3].isNotEmpty) {
      if (segments.length == 4) {
        return true;
      }
      return segments.length == 5 && segments[4] == 'comments';
    }
  }
  return false;
}

String _normalizePath(String path) {
  if (path.isEmpty) {
    return '/';
  }
  return _join(_segments(path));
}

List<String> _segments(String path) => [
  for (final segment in path.split('/'))
    if (segment.isNotEmpty) segment,
];

String _join(List<String> segments) =>
    segments.isEmpty ? '/' : '/${segments.join('/')}';

/// Copy a share carries: the work, and who is credited on it.
///
/// A work nobody is credited on is its own name, rather than a name
/// followed by an empty list. The names are joined the way the reader's
/// language joins a list, so the catalog sentence is the wording around
/// them and nothing else.
String shareMessage(
  AppMessages messages, {
  required String title,
  required List<String> creatorNames,
}) {
  if (creatorNames.isEmpty) {
    return title;
  }
  return messages.shareText(
    title: title,
    creators: messages.formatList(creatorNames),
  );
}
