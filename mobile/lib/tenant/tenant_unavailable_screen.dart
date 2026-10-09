import 'package:flutter/material.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/tenant/tenant_availability.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What the app shows in place of every screen while the tenant is
/// suspended: that the app cannot be used right now, and the offer to ask
/// again.
///
/// It names no reason. A reader has nothing to do about a suspension but come
/// back, which is also all the web site tells them.
class TenantUnavailableScreen extends StatelessWidget {
  const TenantUnavailableScreen({super.key, required this.availability});

  final TenantAvailability availability;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey('tenant-unavailable'),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AutospacedText(
                  messages.tenantSuspendedTitle,
                  style: theme.textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                AutospacedText(
                  messages.tenantSuspendedDescription,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                ListenableBuilder(
                  listenable: availability,
                  builder: (context, _) => FilledButton(
                    key: const ValueKey('tenant-unavailable-retry'),
                    onPressed: availability.checking
                        ? null
                        : availability.recheck,
                    child: AutospacedText(messages.commonRetry),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
