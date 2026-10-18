import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/series_item.dart';

/// An eye-catch the console uploaded for the episode [id], cut both ways.
List<EyeCatchVariant> episodeEyeCatch(String id) => [
  for (final (type, height) in [('landscape', 450), ('portrait', 1066)])
    EyeCatchVariant(
      variantType: type,
      url: Uri.parse('http://images.test/images/episode-eye-catches/$id/$type'),
      width: 800,
      height: height,
    ),
];

/// The [NetworkImage] behind [finder], unwrapping the decode bound the cover
/// puts around it.
NetworkImage requestOf(WidgetTester tester, Finder finder) {
  final image = tester.widget<Image>(finder).image;
  final provider = image is ResizeImage ? image.imageProvider : image;
  return provider as NetworkImage;
}
