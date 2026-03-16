# api-client

ConnectRPC の TypeScript クライアント生成物を配置するパッケージです。

## 運用ルール

- `src/gen/` 以下は自動生成物 (直接編集しない)
- API 仕様の変更は `proto/` を起点に行い、`make gen` で再生成する
