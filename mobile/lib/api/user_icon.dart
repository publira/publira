import 'package:publira/config.dart';

/// The image-server URL of the icon a list of `publira.types.v1.UserIconVariant`
/// describes, resolved against [config], and `null` for an account that shows
/// none.
///
/// An icon is stored as a single rendition, so the first variant is the icon;
/// image-server scales it to whatever size the app draws it at. protojson
/// omits an empty list, which is how an account with no icon arrives.
///
/// Anything this build cannot read is no icon rather than a failure: the name
/// beside it still says whose row it is, and a fallback is what a reader
/// without an icon gets anyway.
Uri? userIconUrl(Object? variants, AppConfig config) {
  if (variants is! List || variants.isEmpty) {
    return null;
  }
  final first = variants.first;
  final url = first is Map ? first['url'] : null;
  if (url is! String || url.trim().isEmpty) {
    return null;
  }
  return config.imageUri(url.trim());
}
