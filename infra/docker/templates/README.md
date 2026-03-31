# Dockerfile templates for server/cmd

`server/cmd/*` 向けの Dockerfile テンプレートです。

## ファイル

- `Dockerfile.api`: API サーバー向け (常駐プロセス + `/healthz` ヘルスチェック)
- `Dockerfile.batch`: バッチ向け (単発実行、ヘルスチェックなし)

## API サーバーのビルド例

```bash
docker build \
  -f infra/docker/templates/Dockerfile.api \
  --build-arg CMD_NAME=platform-api-server \
  --build-arg BINARY_NAME=platform-api-server \
  -t publira/platform-api-server:local \
  .
```

## バッチのビルド例

```bash
docker build \
  -f infra/docker/templates/Dockerfile.batch \
  --build-arg CMD_NAME=publish-episodes \
  --build-arg BINARY_NAME=publish-episodes \
  -t publira/publish-episodes:local \
  .
```

## 実行方針

- API:
  - `ENTRYPOINT`: 対象バイナリを常駐実行
  - `HEALTHCHECK`: `GET http://127.0.0.1:${HEALTHCHECK_PORT}/healthz`
  - 既定ポートは `8000`。`HEALTHCHECK_PORT` は必要に応じて上書き
- Batch:
  - `ENTRYPOINT`: 対象バイナリを 1 回実行し終了
  - `HEALTHCHECK`: 設定しない (単発処理のため)

## 新規 cmd 追加時の流用

1. `CMD_NAME` と `BINARY_NAME` を新しい `server/cmd/<name>` に合わせる
2. API なら待ち受けポートに応じて `HEALTHCHECK_PORT` を設定
3. バッチならそのまま実行。必要なら `CMD` や env を compose 側で指定
