import 'package:flutter/foundation.dart';
import 'package:publira/auth/reader_age.dart';

/// A published page the tenant names as its terms of service or its privacy
/// policy, as `publira.v1.TenantLegalPage` carries it.
@immutable
class LegalPage {
  const LegalPage({
    required this.slug,
    required this.title,
    required this.versionId,
  });

  /// Where the tenant site serves the page, in storage form (`/privacy`).
  final String slug;
  final String title;

  /// The published version, which a sign-up sends back as the text the reader
  /// agreed to.
  final String versionId;

  /// The page [raw] describes, or `null` where any part of it is missing, so
  /// a role the tenant names nothing for is never asked about.
  static LegalPage? fromWire(Object? raw) {
    if (raw is! Map<String, Object?>) {
      return null;
    }
    final slug = _trimmed(raw['slug']);
    final title = _trimmed(raw['title']);
    final versionId = _trimmed(raw['versionId']);
    if (slug.isEmpty || title.isEmpty || versionId.isEmpty) {
      return null;
    }
    return LegalPage(slug: slug, title: title, versionId: versionId);
  }

  static String _trimmed(Object? value) => value is String ? value.trim() : '';

  @override
  bool operator ==(Object other) {
    return other is LegalPage &&
        other.slug == slug &&
        other.title == title &&
        other.versionId == versionId;
  }

  @override
  int get hashCode => Object.hash(slug, title, versionId);
}

/// What the tenant asks of a sign-up beyond a name, an address, and a
/// password: a birth date where it checks ages, and consent to the pages it
/// names.
@immutable
class SignUpRequirements {
  const SignUpRequirements({
    required this.ageVerification,
    this.termsPage,
    this.privacyPage,
  });

  final AgeVerification ageVerification;
  final LegalPage? termsPage;
  final LegalPage? privacyPage;

  /// The pages the reader is asked to agree to, terms first.
  List<LegalPage> get legalPages => [?termsPage, ?privacyPage];
}
