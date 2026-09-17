import 'dart:ui';

/// One colour of a tenant's theme, named the way `TenantTheme` names it.
///
/// [fallback] is the brand default `packages/utils/src/theme-css-variables.ts`
/// keeps for the public site, so a tenant with no theme stored, or a value
/// that is not `#rrggbb`, looks the same in the app as on the web.
enum TenantColor {
  primary('primaryColor', Color(0xFF2B4C8C)),
  primaryForeground('primaryForegroundColor', Color(0xFFFFFFFF)),
  secondary('secondaryColor', Color(0xFFC63D17)),
  secondaryForeground('secondaryForegroundColor', Color(0xFFFFFFFF)),
  accent('accentColor', Color(0xFFE3E9F5)),
  accentForeground('accentForegroundColor', Color(0xFF22407A)),
  background('backgroundColor', Color(0xFFF5F5F2)),
  foreground('foregroundColor', Color(0xFF1F1D1A)),
  surface('surfaceColor', Color(0xFFFAFAF8)),
  surfaceForeground('surfaceForegroundColor', Color(0xFF1F1D1A)),
  card('cardColor', Color(0xFFFFFFFF)),
  cardForeground('cardForegroundColor', Color(0xFF1F1D1A)),
  popover('popoverColor', Color(0xFFFFFFFF)),
  popoverForeground('popoverForegroundColor', Color(0xFF1F1D1A)),
  muted('mutedColor', Color(0xFFE8E8E3)),
  mutedForeground('mutedForegroundColor', Color(0xFF5F5E59)),
  border('borderColor', Color(0xFFD6D6D0)),
  input('inputColor', Color(0xFFCFCFC8)),
  ring('ringColor', Color(0xFF2B4C8C)),
  success('successColor', Color(0xFF2A6B3F)),
  successForeground('successForegroundColor', Color(0xFFFFFFFF)),
  warning('warningColor', Color(0xFF8A5A0B)),
  warningForeground('warningForegroundColor', Color(0xFFFFFFFF)),
  destructive('destructiveColor', Color(0xFF8F1D1D)),
  destructiveForeground('destructiveForegroundColor', Color(0xFFFFFFFF)),
  info('infoColor', Color(0xFF2F5D8A)),
  infoForeground('infoForegroundColor', Color(0xFFFFFFFF));

  const TenantColor(this.wireName, this.fallback);

  /// The protojson field of `TenantTheme` that carries this colour.
  final String wireName;

  final Color fallback;
}

/// The colours of one tenant's theme.
class TenantPalette {
  const TenantPalette._(this._colors);

  /// The brand defaults, for a tenant that has stored no theme.
  static const standard = TenantPalette._({});

  /// Reads a `TenantTheme` as protojson, or the same shape written by
  /// [toWire]. A colour that is missing or not `#rrggbb` is its fallback.
  factory TenantPalette.fromWire(Object? theme) {
    if (theme is! Map) {
      return standard;
    }
    return TenantPalette._({
      for (final color in TenantColor.values)
        color: ?_parseHex(theme[color.wireName]),
    });
  }

  final Map<TenantColor, Color> _colors;

  Color operator [](TenantColor color) => _colors[color] ?? color.fallback;

  Map<String, String> toWire() => {
    for (final entry in _colors.entries)
      entry.key.wireName: _formatHex(entry.value),
  };

  static final _hex = RegExp(r'^#[0-9a-fA-F]{6}$');

  static Color? _parseHex(Object? value) {
    if (value is! String) {
      return null;
    }
    final trimmed = value.trim();
    if (!_hex.hasMatch(trimmed)) {
      return null;
    }
    return Color(0xFF000000 | int.parse(trimmed.substring(1), radix: 16));
  }

  static String _formatHex(Color color) {
    final rgb = color.toARGB32() & 0xFFFFFF;
    return '#${rgb.toRadixString(16).padLeft(6, '0')}';
  }
}

/// The stored logo the catalog app bar draws in place of the tenant name.
class TenantLogo {
  const TenantLogo({
    required this.url,
    required this.width,
    required this.height,
  });

  /// Already resolved against the image base, the way a cover's URL is.
  final Uri url;
  final int width;
  final int height;
}

/// What the app shows of the tenant it was built for.
class TenantBrand {
  const TenantBrand({
    required this.name,
    this.palette = TenantPalette.standard,
    this.logo,
  });

  final String name;
  final TenantPalette palette;

  /// `null` while the tenant has uploaded no logo.
  final TenantLogo? logo;
}
