import 'package:publira/links/app_link.dart';

/// Where a link a tenant wrote — an announcement's, or one inside a published
/// page — takes the reader.
sealed class TenantLinkDestination {
  const TenantLinkDestination();
}

/// A screen of this app.
class InAppDestination extends TenantLinkDestination {
  const InAppDestination(this.location);

  final String location;
}

/// A path on the tenant site the app has no route for: one of the tenant's
/// published pages, which the app shows itself, or else the site's own page
/// at [url].
class SitePathDestination extends TenantLinkDestination {
  const SitePathDestination({required this.path, required this.url});

  /// The locale-less path, which is also a published page's slug when it
  /// names one.
  final String path;
  final Uri url;
}

/// A page on another site, handed to the browser.
class ExternalDestination extends TenantLinkDestination {
  const ExternalDestination(this.url);

  final Uri url;
}

/// Where [linkUrl] takes a reader of [locale], or `null` when it is not a
/// link the app may follow.
///
/// The tenant writes a path on its site or an absolute `http(s)` URL, the
/// shapes the site accepts. A path, or a URL on [site]'s host, opens in the
/// app when the app has that screen, and is otherwise a [SitePathDestination]
/// on the tenant's own site in [locale]. `//evil.example` and
/// `/\evil.example` read as paths to a person and as another origin to a
/// browser, so both are refused.
TenantLinkDestination? tenantLinkDestination(
  String linkUrl, {
  required PublicSite site,
  required String locale,
}) {
  final trimmed = linkUrl.trim();
  if (trimmed.isEmpty || trimmed.length > 2048) {
    return null;
  }
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.startsWith(r'/\')) {
      return null;
    }
    final path = Uri.tryParse(trimmed);
    if (path == null) {
      return null;
    }
    // The prefix the tenant may have written is dropped, so the page opens
    // in the reader's language rather than in the one the link was typed in.
    final bare = stripLocalePrefix(path.path);
    final location = appLocationFor(
      Uri.parse(
        'https://${site.host}',
      ).replace(path: bare, query: path.hasQuery ? path.query : null),
      tenantHost: site.host,
    );
    if (location != null) {
      return InAppDestination(location);
    }
    final page = site.uriFor(bare, locale: locale);
    return SitePathDestination(
      path: bare,
      url: page.replace(
        query: path.hasQuery ? path.query : null,
        fragment: path.hasFragment ? path.fragment : null,
      ),
    );
  }
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
    return null;
  }
  final url = Uri.tryParse(trimmed);
  if (url == null || url.host.isEmpty) {
    return null;
  }
  final location = appLocationFor(url, tenantHost: site.host);
  if (location != null) {
    return InAppDestination(location);
  }
  if (url.host.toLowerCase() == site.host.split(':').first.toLowerCase()) {
    return SitePathDestination(path: stripLocalePrefix(url.path), url: url);
  }
  return ExternalDestination(url);
}
