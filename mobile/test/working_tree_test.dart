import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../scripts/app_manifest/working_tree.dart';

void main() {
  late Directory repository;

  Future<void> git(List<String> arguments) async {
    final result = await Process.run('git', [
      '-c',
      'user.name=Publira',
      '-c',
      'user.email=publira@example.com',
      ...arguments,
    ], workingDirectory: repository.path);
    expect(result.exitCode, 0, reason: '${result.stderr}');
  }

  Future<void> write(String path, String contents) async {
    final file = File('${repository.path}/$path');
    await file.parent.create(recursive: true);
    await file.writeAsString(contents);
  }

  Future<WorkingTreeSnapshot> snapshot() async =>
      (await WorkingTreeSnapshot.take(Directory('${repository.path}/app')))!;

  setUp(() async {
    repository = await Directory.systemTemp.createTemp('working-tree');
    await git(['init', '--quiet']);
    await write('.gitignore', 'generated/\n');
    await write('app/tracked.txt', 'tracked\n');
    await write('app/renamed.txt', 'renamed\n');
    await git(['add', '.']);
    await git(['commit', '--quiet', '-m', 'initial']);
  });

  tearDown(() => repository.delete(recursive: true));

  test('a build that changes nothing leaves no change', () async {
    await write('app/tracked.txt', 'edited before the build\n');
    final before = await snapshot();
    await write('app/generated/app.properties', 'ignored\n');
    expect((await snapshot()).changedSince(before), isEmpty);
  });

  test('reports a tracked file the build changed', () async {
    final before = await snapshot();
    await write('app/tracked.txt', 'changed\n');
    expect((await snapshot()).changedSince(before), [' M app/tracked.txt']);
  });

  test('reports a file the build created and does not ignore', () async {
    final before = await snapshot();
    await write('app/stray.txt', 'stray\n');
    expect((await snapshot()).changedSince(before), ['?? app/stray.txt']);
  });

  test('reports a file already changed that the build changed again', () async {
    await write('app/tracked.txt', 'edited before the build\n');
    await write('app/untracked.txt', 'untracked before the build\n');
    final before = await snapshot();
    await write('app/tracked.txt', 'edited by the build\n');
    await write('app/untracked.txt', 'rewritten by the build\n');
    expect((await snapshot()).changedSince(before), [
      ' M app/tracked.txt',
      '?? app/untracked.txt',
    ]);
  });

  test('reports a change the build reverted', () async {
    await write('app/tracked.txt', 'edited before the build\n');
    final before = await snapshot();
    await git(['checkout', '--', 'app/tracked.txt']);
    expect((await snapshot()).changedSince(before), [
      ' M app/tracked.txt (reverted)',
    ]);
  });

  test('reports a tracked file the build deleted', () async {
    final before = await snapshot();
    await File('${repository.path}/app/tracked.txt').delete();
    expect((await snapshot()).changedSince(before), [' D app/tracked.txt']);
  });

  test('reads a staged rename as one entry', () async {
    await git(['mv', 'app/renamed.txt', 'app/moved.txt']);
    final before = await snapshot();
    expect((await snapshot()).changedSince(before), isEmpty);
    await write('app/moved.txt', 'changed after the rename\n');
    expect((await snapshot()).changedSince(before), ['RM app/moved.txt']);
  });

  test('is not taken outside a Git checkout', () async {
    final outside = await Directory.systemTemp.createTemp('not-a-checkout');
    addTearDown(() => outside.delete(recursive: true));
    expect(await WorkingTreeSnapshot.take(outside), isNull);
  });
}
