import 'package:flutter_test/flutter_test.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/models/series_item.dart';

EyeCatchVariant _variant(String type, int width) => EyeCatchVariant(
  variantType: type,
  url: Uri.parse('http://images.test/images/series/IMG/$type/$width'),
  width: width,
  height: width,
);

void main() {
  test('the nearest stored width to the box wins', () {
    final picked = selectEyeCatchVariant(
      [_variant('portrait', 400), _variant('portrait', 800)],
      preferredTypes: const [eyeCatchPortrait],
      targetWidth: 560,
    );

    expect(picked?.width, 400);
  });

  test('a tie between two widths takes the wider one', () {
    final picked = selectEyeCatchVariant(
      [_variant('portrait', 400), _variant('portrait', 800)],
      preferredTypes: const [eyeCatchPortrait],
      targetWidth: 600,
    );

    expect(picked?.width, 800);
  });

  test('the first preferred type the series carries decides the pool', () {
    final picked = selectEyeCatchVariant(
      [_variant('portrait', 1200), _variant('square', 400)],
      preferredTypes: const [eyeCatchLandscape, eyeCatchPortrait],
      targetWidth: 400,
    );

    expect(picked?.variantType, eyeCatchPortrait);
    expect(picked?.width, 1200);
  });

  test('a series carrying none of the preferred types still shows a cover', () {
    final picked = selectEyeCatchVariant(
      [_variant('og', 1200), _variant('square', 400)],
      preferredTypes: const [eyeCatchPortrait],
      targetWidth: 380,
    );

    expect(picked?.variantType, 'square');
  });

  test('a rendition reporting no width names no image to request', () {
    final picked = selectEyeCatchVariant(
      [_variant('portrait', 0)],
      preferredTypes: const [eyeCatchPortrait],
      targetWidth: 400,
    );

    expect(picked, isNull);
  });

  test('a series with no renditions has nothing to pick', () {
    final picked = selectEyeCatchVariant(
      const [],
      preferredTypes: const [eyeCatchPortrait],
      targetWidth: 400,
    );

    expect(picked, isNull);
  });
}
