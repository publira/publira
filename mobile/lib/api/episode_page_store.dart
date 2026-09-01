import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Body pages kept on the device, addressed by [episodePageKey].
///
/// [EpisodeImageClient] writes a page here once it has turned it into
/// displayable bytes, and reads it back when the network cannot be reached.
/// Neither call may throw: a device that cannot save is a device that reads
/// online, not one whose reader fails.
abstract class EpisodePageStore {
  /// The saved page, or `null` when this device holds none.
  Future<Uint8List?> readPage(String key);

  Future<void> writePage(String key, Uint8List bytes);
}

/// [url] with everything that authorizes one request taken off it.
///
/// A paid page carries a media token in the query that is reissued on every
/// read, while the page behind it does not change. That token is both the
/// reason a saved page has to be named without it and a credential that has no
/// business being written to the device.
Uri episodePageAddress(Uri url) => Uri(
  scheme: url.scheme,
  host: url.host,
  port: url.hasPort ? url.port : null,
  path: url.path,
);

/// Stable name for the page [url] addresses, over [episodePageAddress] so a
/// page saved under one media token is found again under the next.
String episodePageKey(Uri url) =>
    sha256.convert(utf8.encode(episodePageAddress(url).toString())).toString();
