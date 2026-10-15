import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
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
        pb.UserIconVariant(label: 'original', url: '/images/users/1'),
        pb.UserIconVariant(label: 'other', url: '/images/users/2'),
      ], config),
      Uri.parse('http://127.0.0.1:8000/images/users/1'),
    );
  });

  test('an account that shows no icon has none', () {
    expect(userIconUrl(const [], config), isNull);
  });

  test('a URL this build cannot read is no icon rather than a failure', () {
    expect(userIconUrl([pb.UserIconVariant(url: '   ')], config), isNull);
    expect(
      userIconUrl([pb.UserIconVariant(url: '::Not valid URI::')], config),
      isNull,
    );
  });
}
