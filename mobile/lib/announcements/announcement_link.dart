import 'package:publira/links/app_link.dart';

/// Where an announcement's link takes the reader.
sealed class AnnouncementDestination {
  const AnnouncementDestination();
}

/// A screen of this app.
class InAppAnnouncementDestination extends AnnouncementDestination {
  const InAppAnnouncementDestination(this.location);

  final String location;
}

/// A page the app has no screen for, handed to the browser.
class ExternalAnnouncementDestination extends AnnouncementDestination {
  const ExternalAnnouncementDestination(this.url);

  final Uri url;
}

/// Where [linkUrl] takes a reader of [locale], or `null` when it is not a
/// link the app may follow.
///
/// The operator writes a path on the tenant site or an absolute `http(s)` URL,
/// the shapes the site accepts. A path, or a URL on [site]'s host, opens in
/// the app when the app has that screen; any other page opens in the
/// browser, the tenant's own in [locale]. `//evil.example` and
/// `/\evil.example` read as paths to a person and as another origin to a
/// browser, so both are refused.
AnnouncementDestination? announcementDestination(
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
    // The prefix the operator may have written is dropped, so the page opens
    // in the reader's language rather than in the one the link was typed in.
    final bare = stripLocalePrefix(path.path);
    final location = appLocationFor(
      Uri.parse(
        'https://${site.host}',
      ).replace(path: bare, query: path.hasQuery ? path.query : null),
      tenantHost: site.host,
    );
    if (location != null) {
      return InAppAnnouncementDestination(location);
    }
    final page = site.uriFor(bare, locale: locale);
    return ExternalAnnouncementDestination(
      page.replace(
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
  return location == null
      ? ExternalAnnouncementDestination(url)
      : InAppAnnouncementDestination(location);
}
