import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/legal_page_agreements.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/forms/sign_up_fields.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/account_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Where a signed-in reader is asked to agree to a revised terms of service or
/// privacy policy, the way **Finish signing up** asks a first Apple or Google
/// sign-in, before the rest of the app.
///
/// The router holds the reader here while [LegalPageAgreements.owed] names a
/// page, and sends them on to where they were going once it names none, so
/// the screen itself never navigates away: agreeing, signing out, and
/// deleting the account each settle what the reader owes.
class LegalPageAgreementScreen extends StatefulWidget {
  const LegalPageAgreementScreen({super.key});

  @override
  State<LegalPageAgreementScreen> createState() =>
      _LegalPageAgreementScreenState();
}

class _LegalPageAgreementScreenState extends State<LegalPageAgreementScreen> {
  final _formKey = GlobalKey<FormState>();

  /// The locale the pages were last read in.
  Locale? _locale;
  var _submitting = false;
  var _legalPagesChanged = false;
  AuthFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context);
    if (locale == _locale) {
      return;
    }
    _locale = locale;
    // Read again in the screen's own locale, so the versions agreed to are
    // the translations it links to.
    unawaited(
      LegalPageAgreementScope.maybeOf(
        context,
      )?.check(locale: locale.toLanguageTag()),
    );
  }

  Future<void> _submit(
    LegalPageAgreements agreements,
    List<LegalPage> pages,
  ) async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _submitting = true;
      _failure = null;
      _legalPagesChanged = false;
    });
    AuthFailureKind? failure;
    var settled = false;
    try {
      settled = await agreements.agree(pages);
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
      _legalPagesChanged = failure == null && !settled;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final agreements = LegalPageAgreementScope.maybeOf(context);
    final pages = agreements?.owed ?? const <LegalPage>[];
    final failure = _failure;
    final error = Theme.of(context).colorScheme.error;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: AutospacedText(messages.legalPageAgreementTitle),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ReadableWidth(
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AutospacedText(messages.legalPageAgreementDescription),
                  if (failure != null) ...[
                    const SizedBox(height: 16),
                    AutospacedText(
                      switch (failure) {
                        AuthFailureKind.network =>
                          messages.errorsRpcUnavailable,
                        AuthFailureKind.rateLimited =>
                          messages.errorsRpcRateLimited,
                        _ => messages.legalPageAgreementFailed,
                      },
                      key: const ValueKey('legal-page-agreement-error'),
                      style: TextStyle(color: error),
                    ),
                  ] else if (_legalPagesChanged) ...[
                    const SizedBox(height: 16),
                    AutospacedText(
                      messages.signUpConsentChanged,
                      key: const ValueKey('legal-page-agreement-changed'),
                      style: TextStyle(color: error),
                    ),
                  ],
                  if (pages.isNotEmpty)
                    ConsentField(
                      // A version published while the screen was open asks
                      // for the box to be ticked anew.
                      key: ValueKey(
                        pages.map((page) => page.versionId).join(','),
                      ),
                      pages: pages,
                      pagePath: AppRoutes.agreementPagePath,
                      requiredMessage: messages.legalPageAgreementRequired,
                    ),
                  const SizedBox(height: 24),
                  FilledButton(
                    key: const ValueKey('legal-page-agreement-submit'),
                    onPressed: _submitting || agreements == null
                        ? null
                        : () => unawaited(_submit(agreements, pages)),
                    child: _submitting
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : AutospacedText(messages.legalPageAgreementSubmit),
                  ),
                  const SizedBox(height: 32),
                  AutospacedText(messages.legalPageAgreementDecline),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      TextButton(
                        key: const ValueKey('legal-page-agreement-sign-out'),
                        onPressed: () => unawaited(signOut(context)),
                        child: AutospacedText(messages.accountSignOut),
                      ),
                      TextButton(
                        key: const ValueKey('legal-page-agreement-delete'),
                        style: TextButton.styleFrom(foregroundColor: error),
                        onPressed: () =>
                            unawaited(context.push(AppRoutes.agreementDelete)),
                        child: AutospacedText(messages.accountDelete),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
