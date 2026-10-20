import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/follow_tenant_link.dart';
import 'package:publira/links/tenant_link.dart';
import 'package:publira/models/campaign_banner.dart';

/// The ratio a banner is drawn in: the landscape cut, which the console crops
/// for the band, so the image is shown whole rather than cut again.
const _bannerAspectRatio = 16 / 9;

/// The widest the band is drawn. A banner keeps its ratio, so one the width of
/// a tablet would stand taller than the shelves the reader came for.
const _maxBandWidth = 720.0;

/// The share of the band one banner takes when there are several, which
/// leaves the edge of the next one showing: that is what says the band
/// scrolls, without a control of its own.
const _pageFraction = 0.9;

/// The campaigns the tenant has on right now, at the top of the catalog, in
/// the operator's order. A banner opens the link it carries.
///
/// Nothing at all is drawn while the read is in flight, when it fails, or when
/// nothing is scheduled, so a tenant that schedules no banner has the catalog
/// it always had: the band is an addition to the screen rather than a part of
/// it, and a skeleton for a band most tenants never fill would flash on every
/// launch. A banner whose link the app may not follow, or whose image has no
/// rendition left to draw, is dropped, since a banner is a picture that is a
/// link and has lost one half.
///
/// One banner is one band. Several are pages the reader swipes through.
class CampaignBannerBand extends StatefulWidget {
  const CampaignBannerBand({super.key, required this.refreshes});

  /// Pulls to refresh so far. A change reads the banners again, keeping the
  /// ones on screen until the answer replaces them.
  final int refreshes;

  @override
  State<CampaignBannerBand> createState() => _CampaignBannerBandState();
}

class _CampaignBannerBandState extends State<CampaignBannerBand> {
  final _pages = PageController(viewportFraction: _pageFraction);

  /// What the API last answered, and empty until it has.
  List<CampaignBanner> _banners = const [];

  CatalogRepository? _catalog;

  /// Counts the reads this band has started, so an answer to one it has
  /// stopped waiting for cannot land on the screen.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _banners = const [];
    _load();
  }

  @override
  void didUpdateWidget(covariant CampaignBannerBand oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshes != oldWidget.refreshes) {
      _load();
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _load() {
    unawaited(_read(++_reads, _catalog!));
  }

  Future<void> _read(int read, CatalogRepository catalog) async {
    List<CampaignBanner> banners;
    try {
      banners = await catalog.listCampaignBanners();
    } on CatalogFailure {
      banners = const [];
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _banners = banners;
    });
  }

  @override
  Widget build(BuildContext context) {
    final banners = [
      for (final banner in _banners)
        if (tenantLinkDestinationFrom(context, banner.linkUrl)
            case final destination?)
          if (banner.imageVariants.any((variant) => variant.width > 0))
            (banner: banner, destination: destination),
    ];
    if (banners.isEmpty) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Padding(
      key: const ValueKey('campaign-banners'),
      padding: const EdgeInsets.only(top: 16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bandWidth = math.min(constraints.maxWidth, _maxBandWidth);
          if (banners.length == 1) {
            final only = banners.single;
            return Center(
              child: SizedBox(
                width: bandWidth - 32,
                child: _BannerLink(
                  banner: only.banner,
                  destination: only.destination,
                  fallbackLabel: messages.catalogCampaignBanner,
                ),
              ),
            );
          }
          final pageWidth = bandWidth * _pageFraction;
          return Center(
            child: SizedBox(
              width: bandWidth,
              height: (pageWidth - 8) / _bannerAspectRatio,
              child: PageView.builder(
                controller: _pages,
                itemCount: banners.length,
                itemBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: _BannerLink(
                    banner: banners[index].banner,
                    destination: banners[index].destination,
                    // The pages announce no position of their own, and every
                    // banner without words of its own would otherwise be read
                    // out as the same one.
                    fallbackLabel: messages.catalogCampaignBannerPosition(
                      position: messages.formatInteger(index + 1),
                      count: messages.formatInteger(banners.length),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// One banner, which opens [destination] when tapped.
class _BannerLink extends StatelessWidget {
  const _BannerLink({
    required this.banner,
    required this.destination,
    required this.fallbackLabel,
  });

  final CampaignBanner banner;
  final TenantLinkDestination destination;

  /// What a screen reader announces the banner as when the operator wrote no
  /// words for its image. The image is the link's only content, so those
  /// words, when there are some, are its name, as they are on the storefront.
  final String fallbackLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: banner.altText.isEmpty ? fallbackLabel : banner.altText,
      child: InkWell(
        key: ValueKey('campaign-banner-${banner.id}'),
        onTap: () => followTenantLink(context, destination),
        child: EyeCatchCover(
          kind: 'campaign-banner',
          id: banner.id,
          variants: banner.imageVariants,
          requestHeaders: banner.imageRequestHeaders,
          preferredTypes: const [eyeCatchLandscape],
          aspectRatio: _bannerAspectRatio,
          placeholderIcon: null,
        ),
      ),
    );
  }
}
