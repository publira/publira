import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/config.dart';

/// The image-server URL of the icon [variants] describe, resolved against
/// [config], and `null` for an account that shows none.
///
/// An icon is stored as a single rendition, so the first variant is the icon;
/// image-server scales it to whatever size the app draws it at. An account
/// with no icon has no variant.
///
/// A URL this build cannot read is no icon rather than a failure: the name
/// beside it still says whose row it is, and a fallback is what a reader
/// without an icon gets anyway.
Uri? userIconUrl(List<pb.UserIconVariant> variants, AppConfig config) {
  if (variants.isEmpty) {
    return null;
  }
  final url = variants.first.url.trim();
  if (url.isEmpty) {
    return null;
  }
  try {
    return config.imageUri(url);
  } on FormatException {
    return null;
  }
}
