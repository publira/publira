-- A dark palette for the development seed tenant, so its storefront offers the
-- header's Theme control and the console's Branding screen opens with one
-- saved. The storefront offers that control only to a tenant that has saved a
-- dark palette.
--
-- The tenant keeps no `tenant_themes` row: the light palette stays the column
-- defaults, and this one is their dark counterpart. Each color keeps the hue
-- of its light default, and the surfaces keep the light palette's order —
-- surface and card lighter than the page — rather than the inverted one the
-- console's Derive from light gives, where the card falls below the page.
-- Every text pair clears the 4.5:1 the console's save requires.
--
-- `e2e/src/scenarios/seed-dark-theme.ts` holds the same colors, which the
-- brand settings suite saves back after deleting the palette.
INSERT INTO tenant_theme_dark (
    tenant_id,
    background_color,
    foreground_color,
    surface_color,
    surface_foreground_color,
    card_color,
    card_foreground_color,
    popover_color,
    popover_foreground_color,
    primary_color,
    primary_foreground_color,
    secondary_color,
    secondary_foreground_color,
    accent_color,
    accent_foreground_color,
    muted_color,
    muted_foreground_color,
    border_color,
    input_color,
    ring_color,
    success_color,
    success_foreground_color,
    warning_color,
    warning_foreground_color,
    destructive_color,
    destructive_foreground_color,
    info_color,
    info_foreground_color
)
SELECT
    t.id,
    '#171614',
    '#ecebe6',
    '#1d1c19',
    '#ecebe6',
    '#23221f',
    '#ecebe6',
    '#23221f',
    '#ecebe6',
    '#8ea9e0',
    '#0f1d3a',
    '#ea7a52',
    '#220902',
    '#1e2a42',
    '#c3d2f0',
    '#2b2a26',
    '#aaa8a1',
    '#3a3934',
    '#46453f',
    '#8ea9e0',
    '#7cc796',
    '#0b2414',
    '#e3b264',
    '#2a1a02',
    '#e87a7a',
    '#2b0707',
    '#84acd8',
    '#0b1a2b'
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (tenant_id) DO UPDATE
SET background_color = EXCLUDED.background_color,
    foreground_color = EXCLUDED.foreground_color,
    surface_color = EXCLUDED.surface_color,
    surface_foreground_color = EXCLUDED.surface_foreground_color,
    card_color = EXCLUDED.card_color,
    card_foreground_color = EXCLUDED.card_foreground_color,
    popover_color = EXCLUDED.popover_color,
    popover_foreground_color = EXCLUDED.popover_foreground_color,
    primary_color = EXCLUDED.primary_color,
    primary_foreground_color = EXCLUDED.primary_foreground_color,
    secondary_color = EXCLUDED.secondary_color,
    secondary_foreground_color = EXCLUDED.secondary_foreground_color,
    accent_color = EXCLUDED.accent_color,
    accent_foreground_color = EXCLUDED.accent_foreground_color,
    muted_color = EXCLUDED.muted_color,
    muted_foreground_color = EXCLUDED.muted_foreground_color,
    border_color = EXCLUDED.border_color,
    input_color = EXCLUDED.input_color,
    ring_color = EXCLUDED.ring_color,
    success_color = EXCLUDED.success_color,
    success_foreground_color = EXCLUDED.success_foreground_color,
    warning_color = EXCLUDED.warning_color,
    warning_foreground_color = EXCLUDED.warning_foreground_color,
    destructive_color = EXCLUDED.destructive_color,
    destructive_foreground_color = EXCLUDED.destructive_foreground_color,
    info_color = EXCLUDED.info_color,
    info_foreground_color = EXCLUDED.info_foreground_color,
    updated_at = NOW();
