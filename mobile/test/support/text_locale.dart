import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The locale the [AutospacedText] showing exactly [text] is set in, `null`
/// for one left in the app's.
Locale? textLocaleOf(WidgetTester tester, String text) => tester
    .widget<AutospacedText>(
      find
          .byWidgetPredicate(
            (widget) => widget is AutospacedText && widget.data == text,
          )
          .last,
    )
    .locale;
