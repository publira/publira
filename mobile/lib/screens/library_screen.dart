import 'package:flutter/material.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/library/continue_reading_list.dart';
import 'package:publira/library/downloads_list.dart';
import 'package:publira/library/follows_list.dart';
import 'package:publira/offline/offline_scope.dart';

/// What the reader reads, gathered on one screen: what they are in the middle
/// of, what they follow, and what the device keeps for reading offline.
///
/// Each is a list of its own under a tab of this screen, so each pages and
/// scrolls on its own, and each keeps its place while the reader looks at
/// another. A build that follows nothing or keeps nothing leaves that tab out.
class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final follows = FollowScope.maybeOf(context) != null;
    final downloads = OfflineScope.maybeOf(context) != null;
    return DefaultTabController(
      length: 1 + (follows ? 1 : 0) + (downloads ? 1 : 0),
      child: Scaffold(
        appBar: AppBar(
          title: Text(messages.libraryTitle),
          bottom: TabBar(
            // A third of a phone is narrower than some languages' labels, so
            // each tab takes the width of its own label instead.
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(
                key: const ValueKey('library-tab-continue'),
                text: messages.catalogContinueHeading,
              ),
              if (follows)
                Tab(
                  key: const ValueKey('library-tab-follows'),
                  text: messages.followsTitle,
                ),
              if (downloads)
                Tab(
                  key: const ValueKey('library-tab-downloads'),
                  text: messages.downloadsTitle,
                ),
            ],
          ),
        ),
        body: SafeArea(
          child: TabBarView(
            children: [
              const _KeptAlive(child: ContinueReadingList()),
              if (follows) const _KeptAlive(child: FollowsList()),
              if (downloads) const _KeptAlive(child: DownloadsList()),
            ],
          ),
        ),
      ),
    );
  }
}

/// Keeps a tab's list, and where it was scrolled to, while another tab is on
/// screen.
class _KeptAlive extends StatefulWidget {
  const _KeptAlive({required this.child});

  final Widget child;

  @override
  State<_KeptAlive> createState() => _KeptAliveState();
}

class _KeptAliveState extends State<_KeptAlive>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return widget.child;
  }
}
