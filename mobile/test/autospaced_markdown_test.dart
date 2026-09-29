import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/typography/autospaced_markdown.dart';

Future<void> _pump(WidgetTester tester, String markdown) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: const Locale('ja'),
      supportedLocales: const [Locale('en'), Locale('ja')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: Scaffold(
        body: Builder(
          builder: (context) => AutospacedMarkdownBody(
            data: markdown,
            styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)),
            onTapLink: (text, href, title) {},
            imageBuilder: (uri, title, alt) => const SizedBox.shrink(),
          ),
        ),
      ),
    ),
  );
}

/// The characters drawn with more letter spacing than the text around them,
/// in the paragraph whose plain text is [text].
List<String> _spacedCharacters(WidgetTester tester, String text) {
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

  visit(paragraph.text, 0);
  final base = characters.map((entry) => entry.$2).reduce(min);
  return [
    for (final (character, letterSpacing) in characters)
      if (letterSpacing != base) character,
  ];
}

void main() {
  testWidgets('spaces a heading and a boundary across emphasis', (
    tester,
  ) async {
    await _pump(tester, '## 第2章\n\n**Summer**外伝');

    expect(_spacedCharacters(tester, '第2章'), ['第', '2']);
    expect(_spacedCharacters(tester, 'Summer外伝'), ['r']);
  });

  testWidgets('spaces a tight list item and keeps its nested list', (
    tester,
  ) async {
    await _pump(tester, '- 第1話\n  - Web版\n- 第2話');

    expect(_spacedCharacters(tester, '第1話'), ['第', '1']);
    expect(_spacedCharacters(tester, 'Web版'), ['b']);
    expect(_spacedCharacters(tester, '第2話'), ['第', '2']);
    expect(find.text('•', findRichText: true), findsNWidgets(3));
  });

  testWidgets('keeps a task item its checkbox', (tester) async {
    await _pump(tester, '- [x] 第1話');

    expect(_spacedCharacters(tester, '第1話'), ['第', '1']);
    expect(find.byIcon(Icons.check_box), findsOneWidget);
  });

  testWidgets('spaces a quote and a code block', (tester) async {
    await _pump(tester, '> Web版\n\n```\n第1話\n```');

    expect(_spacedCharacters(tester, 'Web版'), ['b']);
    expect(_spacedCharacters(tester, '第1話\n'), ['第', '1']);
  });

  testWidgets('still draws a table', (tester) async {
    await _pump(tester, '| 話 | 公開 |\n| --- | --- |\n| 第1話 | Web版 |');

    expect(find.byType(Table), findsOneWidget);
    expect(find.text('第1話', findRichText: true), findsOneWidget);
    expect(find.text('Web版', findRichText: true), findsOneWidget);
  });
}
