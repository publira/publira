# web-admin

出版社・編集者がコンテンツを入稿/運用する管理画面です。

## 主な責務

- Series / Episode の登録・編集
- 公開設定 (予約公開を含む)
- テナントごとのブランド設定 (テーマ・ロゴ等)

## 開発

```bash
cd apps/web-admin
pnpm dev
```

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— 管理画面のセッション Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください
