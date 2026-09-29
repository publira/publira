import 'package:flutter/widgets.dart';

/// The languages the web apps turn `text-autospace` on for.
const _autospacedLanguages = {'ja', 'ko', 'zh'};

/// Whether text in [locale] is laid out with [autospace].
bool autospacesLocale(Locale? locale) =>
    locale != null && _autospacedLanguages.contains(locale.languageCode);

enum _SpacingClass { ideograph, letterOrNumeral, other }

final _han = RegExp(r'\p{Script_Extensions=Han}', unicode: true);
final _punctuation = RegExp(r'\p{P}', unicode: true);
final _letter = RegExp(r'[\p{L}\p{M}]', unicode: true);
final _numeral = RegExp(r'\p{Nd}', unicode: true);

/// The letters Unicode's EastAsianWidth.txt gives Wide or Fullwidth, as
/// ranges that only bridge code points which are not letters or marks.
const _wideLetters = [
  (0x1100, 0x115F),
  (0x3005, 0xA48C),
  (0xA960, 0xA97C),
  (0xAC00, 0xD7A3),
  (0xF900, 0xFAD9),
  (0xFF21, 0xFF5A),
  (0x16FE0, 0x1B2FB),
  (0x20000, 0x323AF),
];

/// The character classes CSS Text Level 4 defines for `ideograph-alpha` and
/// `ideograph-numeric`. Punctuation is never an ideograph, as in UTR #59,
/// which is what browsers classify by.
_SpacingClass _classify(int rune) {
  final char = String.fromCharCode(rune);
  final isPunctuation = _punctuation.hasMatch(char);
  if (!isPunctuation &&
      ((rune >= 0x3041 && rune <= 0x30FF) ||
          (rune >= 0x31C0 && rune <= 0x31FF) ||
          _han.hasMatch(char))) {
    return _SpacingClass.ideograph;
  }
  if (_letter.hasMatch(char) &&
      !_wideLetters.any((range) => rune >= range.$1 && rune <= range.$2)) {
    return _SpacingClass.letterOrNumeral;
  }
  if (_numeral.hasMatch(char) && (rune < 0xFF10 || rune > 0xFF19)) {
    return _SpacingClass.letterOrNumeral;
  }
  return _SpacingClass.other;
}

bool _isBoundary(_SpacingClass before, _SpacingClass after) =>
    (before == _SpacingClass.ideograph &&
        after == _SpacingClass.letterOrNumeral) ||
    (before == _SpacingClass.letterOrNumeral &&
        after == _SpacingClass.ideograph);

/// One typographic character unit of a [TextSpan], classified by its base
/// character.
class _Cluster {
  _Cluster(this.text, this.style) : spacingClass = _classify(text.runes.first);

  final String text;
  final TextStyle style;
  final _SpacingClass spacingClass;
  bool spacedAfter = false;
}

/// [span] with an eighth-em gap at each boundary between CJK text and a
/// Latin or digit run, as `text-autospace: normal` draws it.
///
/// The gap is `letterSpacing` on the character before the boundary, so the
/// plain text of the result, which is what a reader selects, copies, and
/// hears, is the plain text of [span]. [style] is the style [span] inherits,
/// and [textScaler] the scaling it is drawn at.
TextSpan autospace(
  TextSpan span, {
  required TextStyle style,
  required TextScaler textScaler,
}) {
  // Keyed by identity: two spans with the same text and style are equal.
  final clusters = Map<TextSpan, List<_Cluster>>.identity();
  _Cluster? previous;
  void collect(InlineSpan span, TextStyle inherited) {
    if (span is! TextSpan) {
      previous = null;
      return;
    }
    final effective = inherited.merge(span.style);
    final text = span.text;
    if (text != null && text.isNotEmpty) {
      final own = [
        for (final cluster in text.characters) _Cluster(cluster, effective),
      ];
      for (final cluster in own) {
        final before = previous;
        if (before != null &&
            _isBoundary(before.spacingClass, cluster.spacingClass)) {
          before.spacedAfter = true;
        }
        previous = cluster;
      }
      clusters[span] = own;
    }
    for (final child in span.children ?? const <InlineSpan>[]) {
      collect(child, effective);
    }
  }

  collect(span, style);
  if (!clusters.values.any((own) => own.any((c) => c.spacedAfter))) {
    return span;
  }
  return _rebuild(span, clusters, textScaler);
}

TextSpan _rebuild(
  TextSpan span,
  Map<TextSpan, List<_Cluster>> clusters,
  TextScaler textScaler,
) {
  final own = clusters[span];
  final children = [
    for (final child in span.children ?? const <InlineSpan>[])
      child is TextSpan ? _rebuild(child, clusters, textScaler) : child,
  ];
  // A span whose semantics label stands in for its text keeps the text whole.
  if (own == null ||
      span.semanticsLabel != null ||
      !own.any((cluster) => cluster.spacedAfter)) {
    return _copy(span, text: span.text, style: span.style, children: children);
  }
  final pieces = <InlineSpan>[];
  final run = StringBuffer();
  void flush() {
    if (run.isNotEmpty) {
      pieces.add(_copy(span, text: run.toString(), style: null));
      run.clear();
    }
  }

  for (final cluster in own) {
    if (!cluster.spacedAfter) {
      run.write(cluster.text);
      continue;
    }
    flush();
    final fontSize = cluster.style.fontSize ?? 14;
    pieces.add(
      _copy(
        span,
        text: cluster.text,
        style: TextStyle(
          letterSpacing:
              (cluster.style.letterSpacing ?? 0) +
              textScaler.scale(fontSize) / 8,
        ),
      ),
    );
  }
  flush();
  return TextSpan(
    style: span.style,
    locale: span.locale,
    spellOut: span.spellOut,
    children: [...pieces, ...children],
  );
}

/// [span] with its text, style, and children replaced, keeping what makes it
/// interactive: a piece split out of a link is still the link.
TextSpan _copy(
  TextSpan span, {
  required String? text,
  required TextStyle? style,
  List<InlineSpan> children = const [],
}) => TextSpan(
  text: text,
  style: style,
  children: children.isEmpty ? null : children,
  recognizer: span.recognizer,
  mouseCursor: span.mouseCursor,
  onEnter: span.onEnter,
  onExit: span.onExit,
  semanticsLabel: span.semanticsLabel,
  semanticsIdentifier: span.semanticsIdentifier,
  locale: span.locale,
  spellOut: span.spellOut,
);

/// [autospace] as a [Text] in [context] would lay [span] out: under the
/// ambient locale, style, and text scaling unless [locale], [style], or
/// [textScaler] replaces them.
TextSpan autospaceIn(
  BuildContext context,
  TextSpan span, {
  TextStyle? style,
  TextScaler? textScaler,
  Locale? locale,
}) {
  if (!autospacesLocale(locale ?? Localizations.maybeLocaleOf(context))) {
    return span;
  }
  return autospace(
    span,
    style: DefaultTextStyle.of(context).style.merge(style),
    textScaler: textScaler ?? MediaQuery.textScalerOf(context),
  );
}

/// [Text] with the spacing between CJK text and a Latin or digit run that
/// the web apps get from `text-autospace`, for the app's catalog copy and the
/// text a tenant writes.
///
/// Under any locale but Japanese, Korean, and Chinese it is exactly [Text].
class AutospacedText extends StatelessWidget {
  const AutospacedText(
    String this.data, {
    super.key,
    this.style,
    this.strutStyle,
    this.textAlign,
    this.textDirection,
    this.locale,
    this.softWrap,
    this.overflow,
    this.textScaler,
    this.maxLines,
    this.semanticsLabel,
    this.textWidthBasis,
    this.textHeightBehavior,
    this.selectionColor,
  }) : textSpan = null;

  const AutospacedText.rich(
    InlineSpan this.textSpan, {
    super.key,
    this.style,
    this.strutStyle,
    this.textAlign,
    this.textDirection,
    this.locale,
    this.softWrap,
    this.overflow,
    this.textScaler,
    this.maxLines,
    this.semanticsLabel,
    this.textWidthBasis,
    this.textHeightBehavior,
    this.selectionColor,
  }) : data = null;

  final String? data;
  final InlineSpan? textSpan;
  final TextStyle? style;
  final StrutStyle? strutStyle;
  final TextAlign? textAlign;
  final TextDirection? textDirection;
  final Locale? locale;
  final bool? softWrap;
  final TextOverflow? overflow;
  final TextScaler? textScaler;
  final int? maxLines;
  final String? semanticsLabel;
  final TextWidthBasis? textWidthBasis;
  final TextHeightBehavior? textHeightBehavior;
  final Color? selectionColor;

  @override
  Widget build(BuildContext context) => Text.rich(
    autospaceIn(
      context,
      TextSpan(text: data, children: [?textSpan]),
      style: style,
      textScaler: textScaler,
      locale: locale,
    ),
    style: style,
    strutStyle: strutStyle,
    textAlign: textAlign,
    textDirection: textDirection,
    locale: locale,
    softWrap: softWrap,
    overflow: overflow,
    textScaler: textScaler,
    maxLines: maxLines,
    semanticsLabel: semanticsLabel,
    textWidthBasis: textWidthBasis,
    textHeightBehavior: textHeightBehavior,
    selectionColor: selectionColor,
  );
}
