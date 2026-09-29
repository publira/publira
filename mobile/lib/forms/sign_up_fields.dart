import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// The oldest birth date the picker offers, matching `oldestPlausibleAge` in
/// `server/internal/ageverification`.
const oldestPlausibleAge = 130;

/// Asks for a date between the oldest one the API finds plausible and today,
/// so nothing the picker can produce is a date the API refuses. `null` when
/// the reader picked none.
Future<DateTime?> pickBirthDate(BuildContext context) async {
  final messages = AppMessages.of(context);
  final now = DateTime.now();
  final picked = await showDatePicker(
    context: context,
    initialEntryMode: DatePickerEntryMode.input,
    initialDatePickerMode: DatePickerMode.year,
    firstDate: DateTime(now.year - oldestPlausibleAge),
    lastDate: now,
    helpText: messages.signUpBirthDateLabel,
  );
  return picked == null
      ? null
      : DateTime.utc(picked.year, picked.month, picked.day);
}

/// The birth date the account is created with, offered only where the tenant
/// checks ages.
///
/// It stays optional there: the API takes a sign-up without one, and the
/// account screen is where a reader gives it afterwards. A tenant read that
/// has not answered yet, or could not, therefore leaves the field out rather
/// than holding the form back — a sign-up sent in the meantime has lost
/// nothing the reader cannot still do.
class BirthDateField extends StatelessWidget {
  const BirthDateField({
    super.key,
    required this.date,
    required this.onPick,
    required this.onClear,
  });

  final DateTime? date;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final picked = date;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),
        InputDecorator(
          key: const ValueKey('sign-up-birth-date'),
          decoration: InputDecoration(
            label: AutospacedText(messages.signUpBirthDateLabel),
            helper: AutospacedText(messages.signUpBirthDateHelp),
            helperMaxLines: 4,
            border: const OutlineInputBorder(),
            suffixIcon: picked == null
                ? AutospacedTooltip(
                    message: messages.signUpBirthDateLabel,
                    child: IconButton(
                      key: const ValueKey('sign-up-birth-date-pick'),
                      icon: const Icon(Icons.calendar_today_outlined),
                      onPressed: onPick,
                    ),
                  )
                : AutospacedTooltip(
                    message: messages.signUpBirthDateClear,
                    child: IconButton(
                      key: const ValueKey('sign-up-birth-date-clear'),
                      icon: const Icon(Icons.close),
                      onPressed: onClear,
                    ),
                  ),
          ),
          child: InkWell(
            onTap: onPick,
            child: AutospacedText(
              picked == null ? '' : messages.formatCalendarDate(picked),
            ),
          ),
        ),
      ],
    );
  }
}

/// Consent to the pages the tenant names as its terms of service and its
/// privacy policy, asked only where it names one, and required there.
///
/// Each page opens on its own screen above the form, so reading it keeps
/// everything the reader has typed.
class ConsentField extends StatelessWidget {
  const ConsentField({super.key, required this.pages});

  final List<LegalPage> pages;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    return FormField<bool>(
      initialValue: false,
      validator: (value) =>
          value ?? false ? null : messages.signUpConsentRequired,
      builder: (field) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          CheckboxListTile(
            key: const ValueKey('sign-up-consent'),
            value: field.value ?? false,
            onChanged: field.didChange,
            title: AutospacedText(messages.signUpConsentLabel),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
          ),
          Wrap(
            spacing: 8,
            children: [
              for (final page in pages)
                TextButton(
                  key: ValueKey('sign-up-legal-page-${page.slug}'),
                  onPressed: () => unawaited(
                    context.pushInTab<void>(
                      AppRoutes.publishedPagePath(page.slug),
                    ),
                  ),
                  child: AutospacedText(page.title),
                ),
            ],
          ),
          if (field.errorText case final error?)
            AutospacedText(
              error,
              key: const ValueKey('sign-up-consent-error'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
        ],
      ),
    );
  }
}
