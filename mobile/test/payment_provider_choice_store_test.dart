import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/purchase/payment_provider_choice.dart';

void main() {
  group('the payment provider file', () {
    late Directory root;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('payment-provider');
    });

    tearDown(() async {
      await root.delete(recursive: true);
    });

    test('reads empty before a provider was chosen', () async {
      final store = FilePaymentProviderChoiceStore(root: () async => root);

      expect(await store.read(), isEmpty);
    });

    test('keeps the provider chosen last', () async {
      final store = FilePaymentProviderChoiceStore(root: () async => root);

      await store.write('stripe');
      await store.write('payjp');

      expect(
        await FilePaymentProviderChoiceStore(root: () async => root).read(),
        'payjp',
      );
    });
  });
}
