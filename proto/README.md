# proto

Protobuf の定義と、複数の RPC にまたがる契約上の決めごとを置く。生成物の出力先は [`buf.gen.yaml`](../buf.gen.yaml) のとおり `server/gen`（Go / Connect）と `packages/api-client/src/gen`（TypeScript）で、いずれも `task gen` で再生成する。

## 一覧 RPC の cursor ページネーション

一覧 RPC のページ送りは cursor 方式に統一する（[#692](https://github.com/publira/publira/issues/692) / [#722](https://github.com/publira/publira/issues/722)）。`offset` は指定値ぶんの行を読み飛ばすので後ろのページほど遅く、ページを送っている最中に追加・削除が挟まると境界のレコードが重複・欠落する。

最初にこの形で実装したのは `ListPublishedSeries`（`publira/v1/catalog.proto`）。新しい一覧 RPC はここを写す。

### フィールド

| 向き | フィールド | 型 | 意味 |
| --- | --- | --- | --- |
| Request | `token` | `string` | 直前のレスポンスが返した `previous_token` / `next_token` をそのまま渡す。空文字なら先頭ページ |
| Request | `limit` | `int32` | 1 ページの最大件数。`<= 0` か上限超過なら既定値に落とす |
| Request | `order` | `enum` | 並び替え。選べる一覧だけが持つ。`*_UNSPECIFIED = 0` を既定の並びに割り当てる |
| Response | `previous_token` | `string` | **前**のページを取得するための token。先頭ページなら空文字 |
| Response | `next_token` | `string` | **次**のページを取得するための token。末尾ページなら空文字 |

- 既定値と上限は RPC ごとに定数で持つ。特に理由がなければ既定 20 / 上限 100（`ListAuditLogs` に合わせる）。
- `previous_token` と `next_token` の有無がそのまま「前へ」「次へ」の出し分けになる。クライアントは件数の合計を知らなくてよい。
- 境界の行が消えてページが 0 件になったときは、受け取った token を進行方向と逆側の**復帰 token**として返す。両方を空で返すと、クライアントは先頭ページからやり直す以外に戻る手段を失う。
- **復帰は 1 回まで。** 復帰 token は境界の行を含む比較（inclusive）で引き直すので、境界の行が残っていれば元のページへ戻れる。境界の行そのものが消えていれば復帰クエリも 0 件になり、そこから組み立て直した token も同じ 0 件のページを指す。0 件になったページの token が復帰 token だったときは `previous_token` / `next_token` の両方を空で返し、クライアントを先頭ページへ落とす。空ページの間を往復させない。
- 総件数は返さない。`COUNT(*)` は cursor の利点を打ち消すため、必要になった時点で別 RPC として設計する。

### token の中身

token は**クライアントから見て不透明**な文字列。パディング無し base64url で、中身は次の形。

```
v1|<direction>|<sort key 1>|<sort key 2>|...
```

- `direction` は `f`（token が指す先が次ページ）または `b`（前ページ）。サーバーは向きに応じて比較演算子と `ORDER BY` を反転させ、`b` のときは取得した行を並べ直してから返す。
- sort key は境界となる行の並び替えキーの値。`f` ならそのページの末尾行、`b` なら先頭行から作る。
- クライアントはこの構造に依存しない。組み立ても分解もせず、受け取った文字列をそのまま返すだけ。
- 復帰 token は sort key の後ろに `inclusive` を 1 つ足す。SQL 側はこのフラグで比較を `<` から `<=`（昇順なら `>` から `>=`）へ切り替え、境界の行を含めて引き直す。サーバーが「これは復帰 token か」を判別できるのもこのキーで、上の「復帰は 1 回まで」はこれを見て決める。他の文字列が入っていれば `invalid_argument`。
- 壊れた token は `invalid_argument`。エラーメッセージに内部構造を書かない。

Go 側の符号化と検証は [`server/internal/pagination`](../server/internal/pagination) にある。`Encode` / `Decode` / `NormalizeLimit` / `Page` を使い、RPC ごとに base64 を書き直さない。

### 並び替えキー

- 並び替えキーは**一意に定まる組み合わせ**にする。同着があると、キーセット走査の `WHERE` が同着行をまとめて飛ばすか、同じ行を返し続けるかのどちらかになる。
- タイブレーカーは主キーの `id` を使う。`id` は UUIDv7 で生成時刻順なので、`published_at` や `created_at` が同着でも「後から作られた方が先」という意味のある順序で決まる。`public_id` は `crypto/rand` の Base58 で順序を持たないため、並び替えキーには使わない。
- キーセット走査の比較は行値比較で書く。`(a.created_at, a.id) < ($1, $2)` は複合インデックスに乗るが、`a.created_at < $1 OR (a.created_at = $1 AND a.id < $2)` は乗らないことがある。
- 並び替えキーと同じ組でインデックスを張る。btree は逆順にも走査できるので、昇順・降順で 2 本張る必要はない。
- **`ORDER BY` を実行時のパラメータで分岐させない。** `CASE WHEN $1 THEN ... END` はインデックスの順序と結び付かないので、`LIMIT` の手前で全件ソートが入り、キーセットにした意味がなくなる。並び順ごとに `ORDER BY` を固定した別のクエリに分ける。
- 一覧の 1 行が重い（`json_agg` や複数の `LEFT JOIN` を伴う）なら、キーセット走査は id だけを返す軽いクエリにして、表示内容は id で引く 2 段構えにする。並び順ごとのクエリが数行で済み、重い側は 1 本のままになる。`ListPublishedSeries` はこの形（`db/query/query.sql` の `ListActiveSeriesIDsBy*` と `ListActiveSeriesByIDs`）。

### 並び替えを選べる一覧

- token の先頭キーに**並び替えの名前**（`published_at_desc` など）を入れる。同じ token でも並びが変われば指す位置が変わるため、名前が一致しない token は `invalid_argument` で弾く。黙って読み替えると、存在しないページに飛ぶ。
- クライアントは並びを変えたら token を捨てて先頭ページから引き直す。UI 側で「並び替えを変えたらページを 1 に戻す」を守る。
- 走査の向きは「並び順が降順か」と「token が前ページ方向か」の排他的論理和で決まる。SQL には畳んだあとの 1 つの向きだけを渡し、SQL 側で 2 つのフラグを組み合わせない。

### 既存の `limit` / `offset`

cursor に移した RPC からは `offset` を**削除**し、フィールド番号と名前を `reserved` に入れる。この製品はまだ公開前で、後方互換のために非推奨フィールドを残す理由がない。`limit` は 1 ページの件数としてそのまま使う。

### 実装チェックリスト

1. proto に `token` を足し、`offset` を消して `reserved` にする。Response に `previous_token` / `next_token` を足す。
2. SQL をキーセット走査に書き換える。並び順（と前ページ方向の反転）ごとに `ORDER BY` を固定したクエリを用意し、並び替えキーと同じ組のインデックスを張る。
3. ハンドラーで `pagination.NormalizeLimit` → `pagination.Decode` → `limit + 1` 件取得 → `pagination.Page` の順に処理し、境界行から token を組み立てる。
4. `task gen` を実行し、`sqlc diff` が clean であることを確認する。
