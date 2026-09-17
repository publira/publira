import 'package:flutter/material.dart';
import 'package:publira/tenant/tenant_brand.dart';

/// The status colours Material's [ColorScheme] has no slot for.
class TenantStatusColors extends ThemeExtension<TenantStatusColors> {
  const TenantStatusColors({
    required this.success,
    required this.onSuccess,
    required this.warning,
    required this.onWarning,
    required this.info,
    required this.onInfo,
  });

  factory TenantStatusColors.of(TenantPalette palette) => TenantStatusColors(
    success: palette[TenantColor.success],
    onSuccess: palette[TenantColor.successForeground],
    warning: palette[TenantColor.warning],
    onWarning: palette[TenantColor.warningForeground],
    info: palette[TenantColor.info],
    onInfo: palette[TenantColor.infoForeground],
  );

  final Color success;
  final Color onSuccess;
  final Color warning;
  final Color onWarning;
  final Color info;
  final Color onInfo;

  @override
  TenantStatusColors copyWith({
    Color? success,
    Color? onSuccess,
    Color? warning,
    Color? onWarning,
    Color? info,
    Color? onInfo,
  }) => TenantStatusColors(
    success: success ?? this.success,
    onSuccess: onSuccess ?? this.onSuccess,
    warning: warning ?? this.warning,
    onWarning: onWarning ?? this.onWarning,
    info: info ?? this.info,
    onInfo: onInfo ?? this.onInfo,
  );

  @override
  TenantStatusColors lerp(TenantStatusColors? other, double t) {
    if (other == null) {
      return this;
    }
    return TenantStatusColors(
      success: Color.lerp(success, other.success, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      info: Color.lerp(info, other.info, t)!,
      onInfo: Color.lerp(onInfo, other.onInfo, t)!,
    );
  }
}

/// The light theme drawn from [palette].
///
/// The slots Material has no tenant colour for (inverse, fixed, shadow) come
/// from the tonal palette of the tenant's primary colour, and the rest are the
/// tenant's own: the page background is Material's `surface`, and the web's
/// card, surface, and popover are the containers Material puts cards,
/// navigation bars, and menus on.
ThemeData tenantLightTheme(TenantPalette palette) {
  final scheme = ColorScheme.fromSeed(seedColor: palette[TenantColor.primary])
      .copyWith(
        primary: palette[TenantColor.primary],
        onPrimary: palette[TenantColor.primaryForeground],
        secondary: palette[TenantColor.secondary],
        onSecondary: palette[TenantColor.secondaryForeground],
        tertiary: palette[TenantColor.accent],
        onTertiary: palette[TenantColor.accentForeground],
        error: palette[TenantColor.destructive],
        onError: palette[TenantColor.destructiveForeground],
        surface: palette[TenantColor.background],
        onSurface: palette[TenantColor.foreground],
        surfaceContainerLowest: palette[TenantColor.card],
        surfaceContainerLow: palette[TenantColor.card],
        surfaceContainer: palette[TenantColor.surface],
        surfaceContainerHigh: palette[TenantColor.popover],
        surfaceContainerHighest: palette[TenantColor.muted],
        onSurfaceVariant: palette[TenantColor.mutedForeground],
        outline: palette[TenantColor.input],
        outlineVariant: palette[TenantColor.border],
      );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    focusColor: palette[TenantColor.ring].withValues(alpha: 0.12),
    extensions: [TenantStatusColors.of(palette)],
  );
}

/// The dark theme, derived from the tenant's primary colour until the tenant
/// can store a dark palette of its own (#1783).
///
/// The light palette's backgrounds and foregrounds cannot be reused as they
/// are, so every slot takes the dark tone of the primary colour's tonal
/// palette; only the status colours stay the tenant's.
ThemeData tenantDarkTheme(TenantPalette palette) {
  return ThemeData(
    colorScheme: ColorScheme.fromSeed(
      seedColor: palette[TenantColor.primary],
      brightness: Brightness.dark,
    ),
    useMaterial3: true,
    extensions: [TenantStatusColors.of(palette)],
  );
}
