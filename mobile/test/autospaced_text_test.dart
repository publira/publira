import 'dart:io';
import 'dart:math';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/navigation/autospaced_navigation_destination.dart';
import 'package:publira/typography/autospaced_snack_bar_action.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

const _fontSize = 16.0;
const _gap = _fontSize / 8;

Widget _app(Locale locale, Widget child) => MaterialApp(
  locale: locale,
  supportedLocales: const [
    Locale('en'),
    Locale('ja'),
    Locale('ko'),
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
  ],
  localizationsDelegates: GlobalMaterialLocalizations.delegates,
  home: Scaffold(
    body: DefaultTextStyle(
      style: const TextStyle(fontSize: _fontSize),
      child: Align(alignment: Alignment.topLeft, child: child),
    ),
  ),
);

/// Every character of the laid-out text, with the letter spacing it is drawn
/// with.
List<(String, double)> _spacing(WidgetTester tester) {
  final paragraph = tester.renderObject<RenderParagraph>(find.byType(RichText));
  final characters = <(String, double)>[];
  void visit(InlineSpan span, double inherited) {
    if (span is! TextSpan) {
      return;
    }
    final letterSpacing = span.style?.letterSpacing ?? inherited;
    for (final character in (span.text ?? '').characters) {
      characters.add((character, letterSpacing));
    }
    for (final child in span.children ?? const <InlineSpan>[]) {
      visit(child, letterSpacing);
    }
  }

  visit(paragraph.text, 0);
  return characters;
}

List<String> _spacedCharacters(WidgetTester tester) => [
  for (final (character, letterSpacing) in _spacing(tester))
    if (letterSpacing != 0) character,
];

void main() {
  testWidgets('gives an eighth-em gap to each CJK and Latin boundary', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('1ページあたり5件')),
    );

    expect(_spacedCharacters(tester), ['1', 'り', '5']);
    expect(
      _spacing(tester).where((entry) => entry.$2 != 0).map((entry) => entry.$2),
      everyElement(_gap),
    );
  });

  testWidgets('spaces a Latin title running into CJK text', (tester) async {
    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('Summer Days外伝')),
    );

    expect(_spacedCharacters(tester), ['s']);
  });

  testWidgets('widens the line by the gaps it adds', (tester) async {
    const title = Key('title');
    await tester.pumpWidget(
      _app(const Locale('en'), const AutospacedText('1ページあたり5件', key: title)),
    );
    final unspaced = tester.getSize(find.byKey(title)).width;

    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('1ページあたり5件', key: title)),
    );

    expect(tester.getSize(find.byKey(title)).width, unspaced + 3 * _gap);
  });

  testWidgets('adds nothing where the string already has a space', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('Summer Days 外伝')),
    );

    expect(_spacedCharacters(tester), isEmpty);
  });

  testWidgets('does not space after CJK punctuation', (tester) async {
    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('「Summer」、Days・外伝')),
    );

    expect(_spacedCharacters(tester), isEmpty);
  });

  testWidgets('adds nothing under English', (tester) async {
    await tester.pumpWidget(
      _app(const Locale('en'), const AutospacedText('Summer Days外伝')),
    );

    expect(_spacedCharacters(tester), isEmpty);
  });

  for (final locale in const [
    Locale('ko'),
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
  ]) {
    testWidgets('spaces under ${locale.toLanguageTag()}', (tester) async {
      await tester.pumpWidget(_app(locale, const AutospacedText('第5话')));

      expect(_spacedCharacters(tester), ['第', '5']);
    });
  }

  testWidgets('adds the gap to the letter spacing the style already has', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        const AutospacedText('A外', style: TextStyle(letterSpacing: 0.5)),
      ),
    );

    expect(_spacing(tester), [('A', 0.5 + _gap), ('外', 0.5)]);
  });

  testWidgets('scales the gap with the text', (tester) async {
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        const AutospacedText('A外', textScaler: TextScaler.linear(2)),
      ),
    );

    expect(_spacing(tester).first, ('A', _gap * 2));
  });

  testWidgets('spaces a boundary between two spans with their own styles', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        const AutospacedText.rich(
          TextSpan(
            children: [
              TextSpan(text: '第'),
              TextSpan(text: '12', style: TextStyle(fontSize: 24)),
              TextSpan(text: '話'),
            ],
          ),
        ),
      ),
    );

    expect(_spacing(tester), [('第', _gap), ('1', 0), ('2', 24 / 8), ('話', 0)]);
  });

  testWidgets('keeps the recognizer of a link it splits', (tester) async {
    var taps = 0;
    final recognizer = TapGestureRecognizer()..onTap = () => taps++;
    addTearDown(recognizer.dispose);
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        AutospacedText.rich(
          TextSpan(text: 'Summer Days外伝', recognizer: recognizer),
        ),
      ),
    );

    final paragraph = tester.renderObject<RenderParagraph>(
      find.byType(RichText),
    );
    final recognizers = <GestureRecognizer?>[];
    paragraph.text.visitChildren((span) {
      if (span is TextSpan && span.text != null) {
        recognizers.add(span.recognizer);
      }
      return true;
    });
    expect(recognizers, everyElement(same(recognizer)));

    await tester.tapAt(
      tester.getTopLeft(find.byType(RichText)) + const Offset(4, 4),
    );
    expect(taps, 1);
  });

  testWidgets('leaves the plain text and the semantics label unchanged', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      _app(const Locale('ja'), const AutospacedText('Summer Days外伝')),
    );

    final paragraph = tester.renderObject<RenderParagraph>(
      find.byType(RichText),
    );
    expect(paragraph.text.toPlainText(), 'Summer Days外伝');
    expect(
      tester.getSemantics(find.byType(RichText)),
      matchesSemantics(label: 'Summer Days外伝'),
    );
    semantics.dispose();
  });

  testWidgets('copies the original string', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map<Object?, Object?>)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    final focusNode = FocusNode();
    addTearDown(focusNode.dispose);
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        SelectionArea(
          focusNode: focusNode,
          child: const AutospacedText('1ページあたり5件'),
        ),
      ),
    );
    focusNode.requestFocus();
    await tester.pump();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
    await tester.pump();

    expect(copied, '1ページあたり5件');
  });

  /// The letter spacing each character of the paragraph reading [text] is
  /// drawn with beyond the narrowest.
  List<(String, double)> extraSpacing(WidgetTester tester, String text) {
    final paragraph = tester.renderObject<RenderParagraph>(
      find.byWidgetPredicate(
        (widget) => widget is RichText && widget.text.toPlainText() == text,
      ),
    );
    final characters = <(String, double)>[];
    void visit(InlineSpan span, double inherited) {
      if (span is! TextSpan) {
        return;
      }
      final letterSpacing = span.style?.letterSpacing ?? inherited;
      for (final character in (span.text ?? '').characters) {
        characters.add((character, letterSpacing));
      }
      for (final child in span.children ?? const <InlineSpan>[]) {
        visit(child, letterSpacing);
      }
    }

    visit(paragraph.text, paragraph.text.style?.letterSpacing ?? 0);
    final base = characters.map((entry) => entry.$2).reduce(min);
    return [
      for (final (character, letterSpacing) in characters)
        if (letterSpacing != base) (character, letterSpacing - base),
    ];
  }

  testWidgets('spaces a tooltip at the size the tooltip is set in', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        const AutospacedTooltip(
          message: 'Web版の案内',
          child: SizedBox(key: Key('target'), width: 48, height: 48),
        ),
      ),
    );

    await tester.longPress(find.byKey(const Key('target')));
    await tester.pump(const Duration(seconds: 1));

    // Tooltip sets its message in 14 on a phone, whatever the text around it.
    expect(extraSpacing(tester, 'Web版の案内'), [('b', 14 / 8)]);
    expect(find.byTooltip('Web版の案内'), findsOneWidget);
  });

  testWidgets('spaces a navigation label and its tooltip', (tester) async {
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        NavigationBar(
          selectedIndex: 0,
          destinations: [
            AutospacedNavigationDestination(
              icon: const Icon(Icons.home_outlined),
              label: 'Web版',
              tooltipMessage: '未読2件',
              selected: true,
              index: 0,
              count: 2,
              onTap: () {},
            ),
            AutospacedNavigationDestination(
              key: const Key('second'),
              icon: const Icon(Icons.search),
              label: '検索',
              selected: false,
              index: 1,
              count: 2,
              onTap: () {},
            ),
          ],
        ),
      ),
    );
    final labelSize = Theme.of(
      tester.element(find.byType(NavigationBar)),
    ).textTheme.labelMedium!.fontSize!;

    expect(extraSpacing(tester, 'Web版'), [('b', labelSize / 8)]);

    await tester.longPress(find.text('Web版', findRichText: true));
    await tester.pump(const Duration(seconds: 1));

    expect(extraSpacing(tester, '未読2件'), [('読', 14 / 8), ('2', 14 / 8)]);
  });

  testWidgets('taps a navigation destination, labelled as a tab', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    var taps = 0;
    await tester.pumpWidget(
      _app(
        const Locale('en'),
        NavigationBar(
          selectedIndex: 0,
          destinations: [
            AutospacedNavigationDestination(
              icon: const Icon(Icons.home_outlined),
              label: 'Home',
              selected: true,
              index: 0,
              count: 2,
              onTap: () {},
            ),
            AutospacedNavigationDestination(
              key: const Key('second'),
              icon: const Icon(Icons.search),
              label: 'Search',
              selected: false,
              index: 1,
              count: 2,
              onTap: () => taps++,
            ),
          ],
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('second')));
    expect(taps, 1);
    expect(
      tester.getSemantics(find.byKey(const Key('second'))),
      isSemantics(label: 'Search\nTab 2 of 2', isButton: true),
    );
    semantics.dispose();
  });

  testWidgets('spaces a snack bar action and closes the bar on a press', (
    tester,
  ) async {
    var presses = 0;
    await tester.pumpWidget(
      _app(
        const Locale('ja'),
        Builder(
          builder: (context) => TextButton(
            key: const Key('show'),
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const AutospacedText('期限切れ'),
                action: AutospacedSnackBarAction(
                  label: 'Webで開く',
                  onPressed: () => presses++,
                ),
              ),
            ),
            child: const AutospacedText('show'),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('show')));
    await tester.pumpAndSettle();

    final buttonSize = DefaultTextStyle.of(
      tester.element(find.text('Webで開く', findRichText: true)),
    ).style.fontSize!;
    expect(extraSpacing(tester, 'Webで開く'), [('b', buttonSize / 8)]);

    await tester.tap(find.text('Webで開く', findRichText: true));
    await tester.pumpAndSettle();

    expect(presses, 1);
    expect(find.byType(SnackBar), findsNothing);
  });

  test('the app draws no copy past AutospacedText', () {
    // A framework or package widget handed a String draws it with a plain
    // Text; lib/typography/ holds the widgets that stand in for them.
    final bypass = RegExp(
      r'(?<![\w.])(Text(\.rich)?|SelectableText|Tooltip|'
      r'NavigationDestination|SnackBarAction|MarkdownBody|Markdown)\(|'
      r'\b(labelText|hintText|helperText|errorText|tooltip):',
    );
    final offenders = [
      for (final file in Directory('lib').listSync(recursive: true))
        if (file is File &&
            file.path.endsWith('.dart') &&
            !file.path.startsWith('lib/typography/'))
          for (final (index, line) in file.readAsLinesSync().indexed)
            if (bypass.hasMatch(line)) '${file.path}:${index + 1}: $line',
    ];

    expect(offenders, isEmpty);
  });
}
