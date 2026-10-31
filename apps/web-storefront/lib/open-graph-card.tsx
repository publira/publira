import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  cachedReadFailure,
  dropFailedCacheEntry,
} from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { imageServerLoader } from "@publira/utils/image-loader";
import { isPlaceholderStaticParam } from "@publira/utils/static-param-placeholder";
import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { ImageResponse } from "next/og";

import { OPEN_GRAPH_CARD_HEIGHT, OPEN_GRAPH_CARD_WIDTH } from "./open-graph";
import { loadOpenGraphCardFonts } from "./open-graph-card-fonts";
import type { OpenGraphCardFont } from "./open-graph-card-fonts";
import { resolveOpenGraphCardText } from "./open-graph-card-subject";
import type { OpenGraphCardSubject } from "./open-graph-card-subject";
import {
  getTenantPublicOrigin,
  getTenantSiteInfo,
  getTenantSiteLabel,
  getTenantTheme,
} from "./tenant";
import type { TenantImageVariant } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";
import { resolveTenantLogoVariant } from "./tenant-logo";

/** The tallest the logo is drawn, and the widest a wordmark may run. */
const LOGO_HEIGHT = 72;
const LOGO_MAX_WIDTH = 480;

/** How long the logo may take to arrive before the card names the tenant instead. */
const LOGO_FETCH_TIMEOUT_MS = 5000;

interface CardLogo {
  height: number;
  src: string;
  width: number;
}

/**
 * The uploaded logo as a `data:` URL, at the size the card draws it, or `null`
 * where it could not be fetched — the card then sets the tenant's name in its
 * place, and the entry is dropped so the next request tries again.
 *
 * It is fetched from the tenant's public origin, as a crawler would: the image
 * routes pick the tenant by the `Host` they are reached on, which a request to
 * the API's own address cannot carry. `image/png` is all the request accepts,
 * which keeps the image server from converting the logo, stored as PNG, into a
 * format the card renderer does not read.
 */
const fetchCardLogo = async (
  origin: string,
  variant: TenantImageVariant
): Promise<CardLogo | null> => {
  const width = Math.min(
    LOGO_MAX_WIDTH,
    Math.round((LOGO_HEIGHT * variant.width) / variant.height)
  );

  const height = Math.round((width * variant.height) / variant.width);

  try {
    const response = await fetch(
      imageServerLoader({ src: new URL(variant.url, origin).href, width }),
      {
        headers: { Accept: "image/png" },
        signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
      }
    );

    const contentType = response.headers.get("Content-Type") ?? "";

    if (!(response.ok && contentType.startsWith("image/png"))) {
      throw new Error(`logo answered ${response.status} ${contentType}`);
    }

    const data = Buffer.from(await response.arrayBuffer()).toString("base64");

    return { height, src: `data:image/png;base64,${data}`, width };
  } catch (error) {
    console.warn("[web-storefront] open graph card logo failed", error);
    dropFailedCacheEntry();

    return null;
  }
};

interface CardProps {
  brand: CardLogo | string | undefined;
  colors: TenantThemeColors;
  eyebrow: string | undefined;
  fontFamily: string;
  title: string;
}

/**
 * The card itself, in the subset of CSS `ImageResponse` lays out: a band of
 * the tenant's primary colour, the subject in its foreground on its
 * background, and its brand underneath.
 */
/** Whether the brand line is the site's name in text rather than its logo. */
const isBrandName = (brand: CardProps["brand"]): brand is string =>
  typeof brand === "string";

const Card = ({ brand, colors, eyebrow, fontFamily, title }: CardProps) => (
  <div
    style={{
      backgroundColor: colors.backgroundColor,
      color: colors.foregroundColor,
      display: "flex",
      flexDirection: "column",
      fontFamily,
      height: "100%",
      width: "100%",
    }}
  >
    <div
      style={{
        backgroundColor: colors.primaryColor,
        height: 16,
        width: "100%",
      }}
    />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        justifyContent: "space-between",
        padding: "64px 80px 72px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {eyebrow ? (
          <div
            style={{
              color: colors.primaryColor,
              display: "block",
              fontSize: 36,
              lineClamp: 1,
              lineHeight: 1.3,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div
          style={{
            display: "block",
            fontSize: 68,
            lineClamp: 3,
            lineHeight: 1.25,
          }}
        >
          {title}
        </div>
      </div>
      {isBrandName(brand) ? (
        <div
          style={{
            display: "block",
            fontSize: 36,
            lineClamp: 1,
            lineHeight: 1.3,
          }}
        >
          {brand}
        </div>
      ) : null}
      {brand && !isBrandName(brand) ? (
        // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element -- `ImageResponse` draws plain elements, and `next/image` is not one.
        <img alt="" height={brand.height} src={brand.src} width={brand.width} />
      ) : null}
    </div>
  </div>
);

const quoted = (name: string): string => `"${name}"`;

/** The card as PNG bytes, or a failure where `ImageResponse` could not draw it. */
const drawCard = async (
  props: Omit<CardProps, "fontFamily">,
  fonts: OpenGraphCardFont[]
): Promise<CachedReadResult<Uint8Array<ArrayBuffer>>> => {
  try {
    const response = new ImageResponse(
      <Card
        {...props}
        fontFamily={fonts.map(({ name }) => quoted(name)).join(", ")}
      />,
      { fonts, height: OPEN_GRAPH_CARD_HEIGHT, width: OPEN_GRAPH_CARD_WIDTH }
    );

    return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    console.warn("[web-storefront] open graph card failed", error);

    return cachedReadFailure("open graph card could not be drawn");
  }
};

/**
 * The PNG of `subject`'s card, or `null` where its page would answer 404.
 *
 * The card is one `"use cache"` entry, and every read it is drawn from is a
 * `"use cache"` read that tags its own entry, so those tags reach this one:
 * `POST /api/v1/revalidate` on a series, the theme, or the site purges the
 * card the same way it purges the page. A read that could not be made drops
 * its entry, and with it this one, so a card is never stored half-drawn.
 */
export const getOpenGraphCard = async (
  tenantId: string,
  locale: Locale,
  subject: OpenGraphCardSubject
): Promise<CachedReadResult<Uint8Array<ArrayBuffer> | null>> => {
  "use cache";

  const [text, tenant, theme, siteLabel, origin] = await Promise.all([
    resolveOpenGraphCardText(tenantId, locale, subject),
    getTenantSiteInfo(tenantId),
    getTenantTheme(tenantId),
    getTenantSiteLabel(tenantId, locale),
    getTenantPublicOrigin(tenantId),
  ]);

  if (!(text.ok && text.value)) {
    return text.ok ? { ok: true, value: null } : text;
  }

  const variant = resolveTenantLogoVariant(tenant);
  const logo = origin && variant ? await fetchCardLogo(origin, variant) : null;
  // The site's own card is titled with the tenant's name where it has no
  // tagline, and the brand line would only say it twice.
  const brandName = siteLabel === text.value.title ? undefined : siteLabel;

  const {
    fonts,
    texts: [title = "", eyebrow = "", brand = ""],
  } = await loadOpenGraphCardFonts(locale, [
    text.value.title,
    text.value.eyebrow ?? "",
    logo ? "" : (brandName ?? ""),
  ]);

  // The default palette is what `/theme.css` serves a tenant it cannot read.
  return await drawCard(
    {
      brand: logo ?? (brand || undefined),
      colors: theme?.light ?? DEFAULT_TENANT_THEME_COLORS,
      eyebrow: eyebrow || undefined,
      title,
    },
    fonts
  );
};

/** Browser and edge short cache, as `/theme.css` has; the tags purge the entry. */
const CACHE_CONTROL =
  "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

const statusResponse = (status: number) =>
  new Response(null, { headers: { "Cache-Control": "no-store" }, status });

/**
 * The response of a card's Route Handler: the PNG, a 404 where the page would
 * answer one, and a 503 where a read behind the card could not be made.
 *
 * Route Handlers cannot use `next/root-params`, so the tenant and the locale
 * come from the raw segments and are checked the way `/theme.css` checks its
 * tenant: the placeholder appears while the build generates static paths, and
 * anything else that is not a tenant id or a locale never went through
 * `proxy.ts`. `subject` is `null` where the route's own identifiers failed
 * their schema.
 */
export const openGraphCardResponse = async (
  segments: { locale: string; tenant_id: string },
  subject: OpenGraphCardSubject | null
): Promise<Response> => {
  const tenantId = segments.tenant_id;
  const locale = parseLocale(segments.locale);

  if (
    isPlaceholderStaticParam(tenantId) ||
    !isTenantIdFormat(tenantId) ||
    !locale ||
    !subject
  ) {
    return statusResponse(404);
  }

  const card = await getOpenGraphCard(tenantId.trim(), locale, subject);

  if (!card.ok) {
    return statusResponse(503);
  }

  if (!card.value) {
    return statusResponse(404);
  }

  return new Response(card.value, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "image/png",
    },
  });
};
