import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/user_icon.dart';
import 'package:publira/config.dart';

void main() {
  const config = AppConfig(
    baseUrl: 'http://127.0.0.1:8000',
    tenantHost: 'localhost',
  );

  test('the first variant is the icon, resolved against the API origin', () {
    expect(
      userIconUrl([
        {'label': 'original', 'url': '/images/users/1'},
        {'label': 'other', 'url': '/images/users/2'},
      ], config),
      Uri.parse('http://127.0.0.1:8000/images/users/1'),
    );
  });

  test('an account that shows no icon has none', () {
    // protojson omits the empty list, so the key is usually missing too.
    expect(userIconUrl(null, config), isNull);
    expect(userIconUrl(const [], config), isNull);
  });

  test('a variant this build cannot read is no icon rather than a failure', () {
    expect(userIconUrl('not a list', config), isNull);
    expect(userIconUrl(const ['not a map'], config), isNull);
    expect(
      userIconUrl([
        {'url': '   '},
      ], config),
      isNull,
    );
    expect(
      userIconUrl([
        {'url': '::Not valid URI::'},
      ], config),
      isNull,
    );
  });
}
