import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/router.dart';

/// The app routes `integration_test/reader_parity.json` names as the way to
/// each public-reader capability. `scripts/check-reader-parity.ts` holds the
/// rest of the matrix to web-host and to the app's calls; only the router can
/// say whether a route pattern is one it serves.
List<String> _mobileRoutes() {
  final matrix =
      jsonDecode(File('integration_test/reader_parity.json').readAsStringSync())
          as Map<String, Object?>;
  return [
    for (final capability in matrix['capabilities']! as List<Object?>)
      if ((capability! as Map<String, Object?>)['mobile'] case {
        'routes': final List<Object?> routes,
      })
        for (final route in routes) route! as String,
  ];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('every app route the parity matrix names is one the router serves', () {
    final routes = _mobileRoutes();
    expect(routes, isNotEmpty);

    final configuration = createAppRouter(
      initialLocation: AppRoutes.catalog,
    ).configuration;
    for (final route in routes) {
      final match = configuration.findMatch(Uri.parse(route));
      expect(match.isError, isFalse, reason: '$route is not an app route');
    }
  });
}
