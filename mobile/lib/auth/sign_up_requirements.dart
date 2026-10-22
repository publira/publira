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

  /// The page these parts describe, or `null` where any of them is empty,
  /// so a role the tenant names nothing for is never asked about.
  static LegalPage? fromParts({
    required String slug,
    required String title,
    required String versionId,
  }) {
    final trimmedSlug = slug.trim();
    final trimmedTitle = title.trim();
    final trimmedVersionId = versionId.trim();
    if (trimmedSlug.isEmpty ||
        trimmedTitle.isEmpty ||
        trimmedVersionId.isEmpty) {
      return null;
    }
    return LegalPage(
      slug: trimmedSlug,
      title: trimmedTitle,
      versionId: trimmedVersionId,
    );
  }

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

/// The pages a reader is asked to agree to, terms first, from the roles a
/// `TenantLegalPage` pair names. A page named for both roles is one page, and
/// the API takes one version of it.
List<LegalPage> legalPagesToAgreeTo({
  required LegalPage? termsPage,
  required LegalPage? privacyPage,
}) => [
  ?termsPage,
  if (privacyPage?.versionId != termsPage?.versionId) ?privacyPage,
];

/// What the tenant asks of a sign-up beyond a name, an address, and a
/// password: a birth date where it checks ages, and consent to the pages it
/// names.
///
/// The age rule comes from `GetTenant` and the pages from
/// `GetTenantLegalPages`, read together.
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

  /// The pages the reader is asked to agree to, as [legalPagesToAgreeTo]
  /// lists them.
  List<LegalPage> get legalPages =>
      legalPagesToAgreeTo(termsPage: termsPage, privacyPage: privacyPage);

  /// Whether [other] asks consent to exactly the versions this does.
  bool asksSameConsentAs(SignUpRequirements other) {
    return listEquals(legalPages, other.legalPages);
  }
}
