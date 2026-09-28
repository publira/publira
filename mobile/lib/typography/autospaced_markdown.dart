import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:publira/typography/autospaced_text.dart';

/// [MarkdownBody] with its text set through [AutospacedText] and selectable
/// as one region.
///
/// [MarkdownBody] merges a paragraph's inline runs into one span inside its
/// builder, where nothing can reach them, so paragraphs, headings, and code
/// blocks are laid out here from their syntax tree instead. A tight list
/// item's text, which the syntax tree leaves bare inside the item, is given a
/// paragraph of its own so that it is laid out here too. Table cells are still
/// the package's, and stay unspaced.
class AutospacedMarkdownBody extends StatefulWidget {
  const AutospacedMarkdownBody({
    super.key,
    required this.data,
    required this.styleSheet,
    required this.onTapLink,
    required this.imageBuilder,
  });

  final String data;
  final MarkdownStyleSheet styleSheet;
  final MarkdownTapLinkCallback onTapLink;
  final MarkdownImageBuilder imageBuilder;

  @override
  State<AutospacedMarkdownBody> createState() => _AutospacedMarkdownBodyState();
}

class _AutospacedMarkdownBodyState extends State<AutospacedMarkdownBody> {
  // One per body: it counts the blockquotes the builder is inside.
  final _blocks = _BlockBuilders();

  @override
  Widget build(BuildContext context) {
    _blocks
      ..styleSheet = widget.styleSheet
      ..onTapLink = widget.onTapLink
      ..imageBuilder = widget.imageBuilder;
    return SelectionArea(
      child: MarkdownBody(
        data: widget.data,
        styleSheet: widget.styleSheet,
        onTapLink: widget.onTapLink,
        imageBuilder: widget.imageBuilder,
        blockSyntaxes: const [
          _ParagraphedUnorderedListSyntax(),
          _ParagraphedOrderedListSyntax(),
        ],
        builders: {
          for (final tag in ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
            tag: _TextBlockBuilder(_blocks),
          'pre': _CodeBlockBuilder(_blocks),
          'blockquote': _BlockquoteBuilder(_blocks),
        },
      ),
    );
  }
}

/// What the block builders of one body share.
class _BlockBuilders {
  late MarkdownStyleSheet styleSheet;
  late MarkdownTapLinkCallback onTapLink;
  late MarkdownImageBuilder imageBuilder;
  var blockquoteDepth = 0;

  /// The style [MarkdownBody] gives the text of a [tag] block: the
  /// blockquote's inside one, as the package sets it.
  TextStyle? styleFor(String tag) =>
      blockquoteDepth > 0 ? styleSheet.blockquote : styleSheet.styles[tag];
}

class _BlockquoteBuilder extends MarkdownElementBuilder {
  _BlockquoteBuilder(this.blocks);

  final _BlockBuilders blocks;

  @override
  bool isBlockElement() => true;

  @override
  void visitElementBefore(md.Element element) {
    blocks.blockquoteDepth++;
  }

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    blocks.blockquoteDepth--;
    // The package draws the quote around what its children built.
    return null;
  }
}

class _TextBlockBuilder extends MarkdownElementBuilder {
  _TextBlockBuilder(this.blocks);

  final _BlockBuilders blocks;

  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) => _TextBlock(
    nodes: element.children ?? const [],
    style: blocks.styleFor(element.tag),
    styleSheet: blocks.styleSheet,
    onTapLink: blocks.onTapLink,
    imageBuilder: blocks.imageBuilder,
  );
}

class _CodeBlockBuilder extends MarkdownElementBuilder {
  _CodeBlockBuilder(this.blocks);

  final _BlockBuilders blocks;

  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) => _CodeBlock(
    code: element.textContent,
    style: blocks.styleSheet.code,
    styleSheet: blocks.styleSheet,
  );
}

/// The line height [MarkdownBody] holds each block of text to, so a run in
/// another face or weight does not move its line.
StrutStyle? _strut(
  TextStyle? style,
  MarkdownStyleSheet styleSheet, {
  bool force = true,
}) => style == null
    ? null
    : StrutStyle(
        fontFamily: style.fontFamily,
        fontSize: style.fontSize ?? styleSheet.p?.fontSize,
        height: style.height ?? styleSheet.p?.height,
        leading: 0,
        forceStrutHeight: force,
      );

/// The inline content of a paragraph or heading, laid out as one span.
class _TextBlock extends StatefulWidget {
  const _TextBlock({
    required this.nodes,
    required this.style,
    required this.styleSheet,
    required this.onTapLink,
    required this.imageBuilder,
  });

  final List<md.Node> nodes;
  final TextStyle? style;
  final MarkdownStyleSheet styleSheet;
  final MarkdownTapLinkCallback onTapLink;
  final MarkdownImageBuilder imageBuilder;

  @override
  State<_TextBlock> createState() => _TextBlockState();
}

class _TextBlockState extends State<_TextBlock> {
  final _recognizers = <TapGestureRecognizer>[];
  late TextSpan _span;
  var _hasImage = false;

  // Whether the next text starts a line, whose leading spaces Markdown drops.
  var _atLineStart = true;

  static final _softLineBreak = RegExp(r' ?\n *');
  static final _leadingSpaces = RegExp('^ *');

  @override
  void initState() {
    super.initState();
    _span = _layOut();
  }

  @override
  void didUpdateWidget(_TextBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    _disposeRecognizers();
    _span = _layOut();
  }

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  void _disposeRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  TextSpan _layOut() {
    _hasImage = false;
    _atLineStart = true;
    return TextSpan(children: _spans(widget.nodes, link: null));
  }

  List<InlineSpan> _spans(List<md.Node> nodes, {required _Link? link}) => [
    for (final node in nodes) ?_inline(node, link),
  ];

  InlineSpan? _inline(md.Node node, _Link? link) {
    if (node is md.Text) {
      var text = node.text;
      if (_atLineStart) {
        text = text.replaceFirst(_leadingSpaces, '');
      }
      _atLineStart = false;
      // A soft line break joins the lines with a space, as MarkdownBody does.
      return TextSpan(
        text: text.replaceAll(_softLineBreak, ' '),
        recognizer: link?.recognizer,
      );
    }
    if (node is! md.Element) {
      return null;
    }
    switch (node.tag) {
      case 'br':
        _atLineStart = true;
        return TextSpan(text: '\n', recognizer: link?.recognizer);
      case 'img':
        return _image(node, link);
      case 'input':
        // A task list's checkbox, which MarkdownBody draws beside the item.
        return null;
      case 'a':
        final href = node.attributes['href'];
        final title = node.attributes['title'] ?? '';
        final text = node.textContent;
        void follow() => widget.onTapLink(text, href, title);
        final recognizer = TapGestureRecognizer()..onTap = follow;
        _recognizers.add(recognizer);
        return TextSpan(
          style: widget.styleSheet.a,
          children: _spans(
            node.children ?? const [],
            link: (recognizer: recognizer, onTap: follow),
          ),
        );
      case 'sup':
        return TextSpan(
          style: TextStyle(
            fontFeatures: [
              const FontFeature.enable('sups'),
              if (widget.styleSheet.superscriptFontFeatureTag case final tag?)
                FontFeature.enable(tag),
            ],
          ),
          children: _spans(node.children ?? const [], link: link),
        );
      default:
        return TextSpan(
          style: widget.styleSheet.styles[node.tag],
          children: _spans(node.children ?? const [], link: link),
        );
    }
  }

  InlineSpan? _image(md.Element node, _Link? link) {
    final uri = Uri.tryParse((node.attributes['src'] ?? '').split('#').first);
    if (uri == null) {
      return null;
    }
    _hasImage = true;
    final image = widget.imageBuilder(
      uri,
      node.attributes['title'],
      node.attributes['alt'],
    );
    return WidgetSpan(
      alignment: PlaceholderAlignment.middle,
      child: link == null
          ? image
          : GestureDetector(onTap: link.onTap, child: image),
    );
  }

  @override
  Widget build(BuildContext context) => AutospacedText.rich(
    _span,
    style: widget.style,
    textScaler: widget.styleSheet.textScaler,
    // A forced line height would lay an image over the lines around it.
    strutStyle: _strut(widget.style, widget.styleSheet, force: !_hasImage),
  );
}

typedef _Link = ({TapGestureRecognizer recognizer, VoidCallback onTap});

/// A code block, scrolled sideways rather than wrapped, as [MarkdownBody]
/// sets one.
class _CodeBlock extends StatefulWidget {
  const _CodeBlock({
    required this.code,
    required this.style,
    required this.styleSheet,
  });

  final String code;
  final TextStyle? style;
  final MarkdownStyleSheet styleSheet;

  @override
  State<_CodeBlock> createState() => _CodeBlockState();
}

class _CodeBlockState extends State<_CodeBlock> {
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scrollbar(
    controller: _scroll,
    child: SingleChildScrollView(
      controller: _scroll,
      scrollDirection: Axis.horizontal,
      padding: widget.styleSheet.codeblockPadding,
      child: AutospacedText(
        widget.code,
        style: widget.style,
        textScaler: widget.styleSheet.textScaler,
        strutStyle: _strut(widget.style, widget.styleSheet),
      ),
    ),
  );
}

/// The tags whose elements are blocks rather than inline content.
const _blockTags = {
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'table',
  'section',
};

/// [list] with the bare inline content of each item wrapped in a paragraph.
///
/// A tight list keeps its items' text outside any paragraph, and an item's
/// text next to a nested list cannot be laid out by an element builder
/// without dropping the nested list. A task item's checkbox stays first,
/// where MarkdownBody looks for it.
md.Node _paragraphItems(md.Node list) {
  if (list is! md.Element) {
    return list;
  }
  for (final item in list.children ?? const <md.Node>[]) {
    final children = item is md.Element ? item.children : null;
    if (children == null) {
      continue;
    }
    final wrapped = <md.Node>[];
    final run = <md.Node>[];
    void flush() {
      if (run.isNotEmpty) {
        wrapped.add(md.Element('p', [...run]));
        run.clear();
      }
    }

    for (final (index, child) in children.indexed) {
      final isBlock = child is md.Element && _blockTags.contains(child.tag);
      final isCheckbox =
          index == 0 &&
          child is md.Element &&
          child.attributes['type'] == 'checkbox';
      if (isBlock || isCheckbox) {
        flush();
        wrapped.add(child);
      } else {
        run.add(child);
      }
    }
    flush();
    children
      ..clear()
      ..addAll(wrapped);
  }
  return list;
}

class _ParagraphedUnorderedListSyntax
    extends md.UnorderedListWithCheckboxSyntax {
  const _ParagraphedUnorderedListSyntax();

  @override
  md.Node parse(md.BlockParser parser) => _paragraphItems(super.parse(parser));
}

class _ParagraphedOrderedListSyntax extends md.OrderedListWithCheckboxSyntax {
  const _ParagraphedOrderedListSyntax();

  @override
  md.Node parse(md.BlockParser parser) => _paragraphItems(super.parse(parser));
}
