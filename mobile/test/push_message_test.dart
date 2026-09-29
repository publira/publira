import 'package:flutter_test/flutter_test.dart';
import 'package:publira/push/push_message.dart';

void main() {
  test('the route of a message is the path the server sent', () {
    const message = PushMessage(
      data: {'route': '/series/SERIES01/episodes/EPISODE01'},
    );

    expect(message.route, '/series/SERIES01/episodes/EPISODE01');
  });

  test('a route the app cannot open is refused', () {
    const cases = [
      'https://example.com/series/SERIES01',
      '//example.com/series/SERIES01',
      'series/SERIES01',
      '',
    ];

    for (final route in cases) {
      expect(
        PushMessage(data: {'route': route}).route,
        '',
        reason: 'route $route',
      );
    }
  });

  test('a payload naming no route has none', () {
    expect(const PushMessage().route, '');
  });

  test('a platform payload keeps only the entries it can read', () {
    final message = PushMessage.fromPlatform(
      title: 'Seed Series',
      body: 'Episode Three',
      data: {'route': '/series/SERIES01', 'attempts': 2, 3: 'four'},
    );

    expect(message.title, 'Seed Series');
    expect(message.body, 'Episode Three');
    expect(message.data, {'route': '/series/SERIES01'});
  });

  test('a message with neither a title nor a body has nothing to draw', () {
    expect(const PushMessage(data: {'route': '/'}).hasCopy, isFalse);
    expect(const PushMessage(title: 'Seed Series').hasCopy, isTrue);
  });
}
