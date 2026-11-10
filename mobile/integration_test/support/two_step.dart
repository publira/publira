import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/typography/autospaced_text.dart';

import '../../test/support/pump_until.dart';
import '../../test/support/tap.dart';
import 'type_text.dart';

const _base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

Uint8List _decodeBase32(String encoded) {
  final bytes = <int>[];
  var buffer = 0;
  var bits = 0;
  for (final character in encoded.replaceAll('=', '').toUpperCase().split('')) {
    final value = _base32Alphabet.indexOf(character);
    if (value == -1) {
      throw FormatException('not a base32 character', character);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.add((buffer >> bits) & 0xff);
    }
  }
  return Uint8List.fromList(bytes);
}

/// The code an authenticator app shows for [secret] now, with the parameters
/// `server/internal/mfa/totp.go` enrolls: RFC 6238 over HMAC-SHA1, six
/// digits, a 30-second step.
///
/// [stepsAhead] asks for the code of a later step. The server takes each step
/// once and one step either side of the current one, so a test that sends a
/// second code within the step it has spent reaches for the next one rather
/// than waiting for the clock.
String totpCode(String secret, {int stepsAhead = 0}) {
  final step =
      DateTime.now().millisecondsSinceEpoch ~/
          Duration.millisecondsPerSecond ~/
          30 +
      stepsAhead;
  final counter = ByteData(8)..setInt64(0, step);
  final digest = Hmac(
    sha1,
    _decodeBase32(secret),
  ).convert(counter.buffer.asUint8List()).bytes;
  final offset = digest.last & 0x0f;
  // RFC 4226 drops the top bit so the value reads the same signed or
  // unsigned.
  final binary =
      ((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];
  return (binary % 1000000).toString().padLeft(6, '0');
}

/// Signs in with [email] and [password] on the sign-in form on screen, which
/// an account that holds an authenticator answers with the code step.
Future<void> signInToCodeStep(
  WidgetTester tester, {
  required String email,
  required String password,
}) async {
  await typeText(tester, find.byKey(const ValueKey('sign-in-email')), email);
  await typeText(
    tester,
    find.byKey(const ValueKey('sign-in-password')),
    password,
  );
  await tapReachable(tester, find.byKey(const ValueKey('sign-in-submit')));
  await pumpUntilRouteSettled(
    tester,
    find.byKey(const ValueKey('two-step-submit')),
    timeout: const Duration(seconds: 20),
  );
}

/// Sends [code] from the code step, switching it to take a recovery code
/// first where [recovery] says that is what [code] is.
Future<void> enterTwoStepCode(
  WidgetTester tester,
  String code, {
  bool recovery = false,
}) async {
  if (recovery) {
    await tapReachable(
      tester,
      find.byKey(const ValueKey('two-step-switch-method')),
    );
    await pumpUntilFound(tester, find.text('Recovery code'));
  }
  await typeText(tester, find.byKey(const ValueKey('two-step-code')), code);
  await tapReachable(tester, find.byKey(const ValueKey('two-step-submit')));
}

/// Turns two-step verification on from its screen, which is on screen, with
/// the code [codeFor] answers for the setup key the screen shows, and returns
/// the key and the recovery codes the screen shows once.
Future<({String secret, List<String> recoveryCodes})> turnOnTwoStep(
  WidgetTester tester, {
  required String Function(String secret) codeFor,
}) async {
  final enable = find.byKey(const ValueKey('two-step-verification-enable'));
  await pumpUntilRouteSettled(
    tester,
    enable,
    timeout: const Duration(seconds: 20),
  );
  await tapReachable(tester, enable);
  final secretText = find.byKey(const ValueKey('two-step-verification-secret'));
  await pumpUntilFound(
    tester,
    secretText,
    timeout: const Duration(seconds: 20),
  );
  expect(
    find.bySemanticsLabel('QR code for setting up two-step verification'),
    findsOneWidget,
  );
  final secret = tester.widget<AutospacedText>(secretText).data!;

  await typeText(
    tester,
    find.byKey(const ValueKey('two-step-verification-code')),
    codeFor(secret),
  );
  await tapReachable(
    tester,
    find.byKey(const ValueKey('two-step-verification-confirm')),
  );
  final codesText = find.byKey(
    const ValueKey('two-step-verification-recovery-codes'),
  );
  await pumpUntilFound(tester, codesText, timeout: const Duration(seconds: 20));
  final recoveryCodes = tester
      .widget<AutospacedText>(codesText)
      .data!
      .split('\n');
  expect(recoveryCodes, hasLength(10));

  await tapReachable(
    tester,
    find.byKey(const ValueKey('two-step-verification-done')),
  );
  await pumpUntilFound(
    tester,
    find.byKey(const ValueKey('two-step-verification-remaining')),
  );
  return (secret: secret, recoveryCodes: recoveryCodes);
}
