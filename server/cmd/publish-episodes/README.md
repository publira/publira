# publish-episodes

予約公開向けの単発バッチです。

## 実行

リポジトリルートから:

```bash
make run-batch-publish
```

`server` ディレクトリから:

```bash
go run ./cmd/publish-episodes
```

ビルド済みバイナリを使う場合:

```bash
cd server && make build
./bin/publish-episodes
```

## 備考

- 常駐せず、1 回の処理で終了する前提です。
