/// What the tenant states about the tax its prices include, as
/// `publira.v1.TenantInvoiceDetails` carries it.
class TenantInvoice {
  const TenantInvoice({
    this.taxRateBps,
    this.legalName = '',
    this.registrationNumber = '',
  });

  /// A tenant that states nothing, which is also what a tenant that could not
  /// be read is taken for: no price is said to include tax on a guess.
  static const none = TenantInvoice();

  /// The rate every price offered now includes, in basis points, and `null`
  /// where the tenant states none.
  final int? taxRateBps;

  /// The name the tenant issues invoices under. Empty where it entered none.
  final String legalName;

  /// The tenant's registration number. Empty where it entered none.
  final String registrationNumber;

  /// Whether the prices the app offers say they include tax.
  bool get taxIncluded => taxRateBps != null;
}
