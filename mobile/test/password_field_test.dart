import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/forms/password_field.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/localizations.dart';

import 'support/tooltip.dart';

void main() {
  const typed = 'correct horse';

  final field = find.byKey(const ValueKey('password'));
  final toggle = find.descendant(of: field, matching: find.byType(IconButton));

  Future<TextEditingController> pumpField(
    WidgetTester tester, {
    Locale locale = const Locale('en'),
  }) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        locale: locale,
        supportedLocales: AppMessages.supportedLocales,
        localizationsDelegates: appLocalizationsDelegates,
        home: Scaffold(
          body: Form(
            child: PasswordField(
              key: const ValueKey('password'),
              controller: controller,
              label: 'Password',
              autofillHints: const [AutofillHints.password],
              textInputAction: TextInputAction.done,
              validator: (_) => null,
            ),
          ),
        ),
      ),
    );
    return controller;
  }

  bool obscured(WidgetTester tester) => tester
      .widget<EditableText>(
        find.descendant(of: field, matching: find.byType(EditableText)),
      )
      .obscureText;

  testWidgets('starts masked, and the eye button reveals and masks again', (
    tester,
  ) async {
    final controller = await pumpField(tester);
    await tester.enterText(field, typed);

    expect(obscured(tester), isTrue);

    await tester.tap(toggle);
    await tester.pump();
    expect(obscured(tester), isFalse);
    expect(controller.text, typed);

    await tester.tap(toggle);
    await tester.pump();
    expect(obscured(tester), isTrue);
    expect(controller.text, typed);
  });

  testWidgets('the tooltip names what pressing the button does', (
    tester,
  ) async {
    await pumpField(tester);

    expect(findTooltip('Show password'), findsOneWidget);
    expect(findTooltip('Hide password'), findsNothing);

    await tester.tap(toggle);
    await tester.pump();

    expect(findTooltip('Hide password'), findsOneWidget);
    expect(findTooltip('Show password'), findsNothing);
  });

  testWidgets('a screen reader hears the state, and can switch it by name', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await pumpField(tester);

    expect(
      tester.getSemantics(toggle),
      matchesSemantics(
        label: 'Show password',
        isButton: true,
        hasEnabledState: true,
        isEnabled: true,
        isFocusable: true,
        hasTapAction: true,
        hasFocusAction: true,
      ),
    );

    tester.semantics.tap(find.semantics.byLabel('Show password'));
    await tester.pump();

    expect(obscured(tester), isFalse);
    expect(tester.getSemantics(toggle).label, 'Hide password');
    semantics.dispose();
  });

  testWidgets("the button's name follows the app's locale", (tester) async {
    final semantics = tester.ensureSemantics();
    await pumpField(tester, locale: const Locale('ja'));

    expect(tester.getSemantics(toggle).label, 'パスワードを表示');
    expect(findTooltip('パスワードを表示'), findsOneWidget);

    await tester.tap(toggle);
    await tester.pump();

    expect(tester.getSemantics(toggle).label, 'パスワードを隠す');
    expect(findTooltip('パスワードを隠す'), findsOneWidget);
    semantics.dispose();
  });
}
