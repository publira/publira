---
title: WAF
description: Publiraの前段に置くWAFで有効にするマネージドルール、Publiraのリクエストのうち例外にしないと拒否されるもの、管理画面を自社のネットワークに限る方法を説明します。
published: 2026-10-30
updated: 2026-10-31
source_updated: 2026-10-30
---

WAF(Web Application Firewall)は、リバースプロキシの前段でリクエストを1つずつ検査し、SQLインジェクション、クロスサイトスクリプティング、パストラバーサル、よく使われるソフトウェアの既知の脆弱性を探るリクエストなど、攻撃に見えるものを拒否します。拒否されたリクエストは、自分で運用しているものには届きません。

Publiraは、WAFがなくても安全なように作られています。WAFはPublira自身の検査の手前に置くもう1つの防御で、スキャナーや、アップグレードで修正される前の脆弱性への攻撃も止めます。スタッフが決まったネットワークから作業するなら、管理画面をインターネットから隠すこともできます。

クラウドで運用する場合、Publiraの前にはたいていマネージドのロードバランサーやCDNがあるので、それに付いているWAFを使います。CloudFrontやApplication Load Balancerに付けるAWS WAF、Google Cloudのロードバランサーに付けるCloud Armor、Cloudflareなどです。[レート制限](./5-rate-limits.md)で説明しているとおり、1つのクライアントが送れるリクエストの数も同じWAFで制限します。

## マネージドルールを有効にする

どのWAFにも、ベンダーが保守している一般的な攻撃向けのルールセットがあります。次のルールセットを有効にしてください。

| WAF | ルールセット |
| --- | --- |
| AWS WAF | [コアルールセット](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)(`AWSManagedRulesCommonRuleSet`)と既知の不正な入力(`AWSManagedRulesKnownBadInputsRuleSet`)と[SQLデータベース](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html)のルールグループ(`AWSManagedRulesSQLiRuleSet`)です。CloudFrontのディストリビューションかロードバランサーのウェブACLに追加します。 |
| Google Cloud Armor | OWASP Core Rule Set 4.22に基づく[事前構成されたWAFルール](https://cloud.google.com/armor/docs/waf-rules)です。少なくとも`sqli-v422-stable`、`xss-v422-stable`、`lfi-v422-stable`、`rfi-v422-stable`、`rce-v422-stable`、`protocolattack-v422-stable`、`scannerdetection-v422-stable`を、ロードバランサーのバックエンドサービスに付けたセキュリティポリシーに追加します。誤検知の最も少ない感度1から始め、ログに誤検知がなくなってから感度を上げてください。 |
| Cloudflare | Pro以上のプランでは[Cloudflare Managed RulesetとCloudflare OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/)を、FreeプランではCloudflare Free Managed Rulesetを有効にします。 |

読者やプロバイダーの正当なリクエストをルールが拒否すれば、障害と同じくPubliraは使えなくなります。最初は、どのルールも拒否せず記録だけするようにしてください。AWS WAFではルールのアクションをCountに上書きし、Cloud Armorではプレビューモードにします。実際のリクエストに対してルールが何を拒否しようとしたかを確かめ、引っかかったものを次の節のとおり例外にしてから、拒否するように切り替えます。

## マネージドルールに拒否されるリクエスト

ルールセットは一般的なWebアプリケーションを想定しているので、Publiraのリクエストの中にはそのままでは拒否されるものがあります。

| リクエスト | 中身 | 拒否するルール | 対処 |
| --- | --- | --- | --- |
| アップロード(管理画面のホストの`/api/v1/episode-pages`、それ以外の`/api/v1/`、画像をアップロードするページ、公開APIへの読者のアイコンの送信) | 最大で256MiB、33MiB、11MiB、15MiBの本文です。詳しくは[テナント管理画面でのアップロード](../../2-deployments/4-edge/index.md#テナント管理画面でのアップロード)と[ページからの画像のアップロード](../../2-deployments/4-edge/index.md#ページからの画像のアップロード)を参照してください。 | AWS WAFの`SizeRestrictions_BODY`は、8KBを超える本文をすべて拒否します。 | このルールはCountにします。本文のサイズは、リバースプロキシの上限で制限すれば十分です。 |
| `/api/v1/webhook/`配下のWebhook | 決済プロバイダーのイベントや、HTMLと添付ファイルを含む読者の返信メールそのものです。 | クロスサイトスクリプティング、SQLインジェクション、ファイルインクルージョンを本文から探すルールが、メールのHTMLや文面に反応します。 | このパスではマネージドルールをスキップします。Publiraは各プロバイダーが本文に付けた署名を自分で検証するので、偽のリクエストはルールがなくても拒否されます。拒否された正当な通知は再試行されたあとに失われます。詳しくは[Webhook](../../2-deployments/4-edge/index.md#webhook)を参照してください。 |
| 読者やスタッフが書く文章(コメント、お問い合わせ、管理画面のホストで書くページ、お知らせ、返信) | 作品のタイトルに`<b>`が表示される理由を尋ねるコメントのように、コードを含むことがある文章です。 | クロスサイトスクリプティングとSQLインジェクションを本文から探すルール | ルールは残します。こうした文章が拒否されているとログでわかったら、そのルールの感度を下げるか、ログインしたスタッフしか書き込まない管理画面のホストに限ってそのルールをスキップしてください。 |

モバイルアプリは、公開APIへのリクエストをバイナリのProtocol Buffers(`application/proto`)で送ります。文字列のフィールドは読者が入力したバイト列のままWAFに届くので、本文を検査するルールはフォームの送信と同じように中身を読みます。

WAFが検査するのは本文の先頭だけです。AWS WAFではApplication Load Balancerで8KB、CloudFrontでは既定で16KB、Cloud Armorでは最大64KB、CloudflareではFreeプランで1MB、Enterpriseで128KBです。AWS WAFで上限を超えた本文の扱いはContinueのままにして、上限までを検査させてください。ブロックするルールでMatchにすると、すべてのアップロードが拒否されます。

## 管理画面を自社のネットワークに限る

管理画面のホストを使うのは、テナントのスタッフとプラットフォームのオペレーターだけです。読者もモバイルアプリもWebhookも、届くのはテナントのサイトで、管理画面のホストには来ません。スタッフがオフィスやVPNのような決まったネットワークから作業するなら、管理画面のホストにはそのアドレスだけを通してください。AWS WAFではIPセット、Cloud Armorでは送信元アドレスで一致させるルール、Cloudflareではカスタムルールを使います。そうすれば、管理画面のログインページはインターネットから見えなくなります。ほかの場所から招待やパスワードの再設定のリンクを開いたスタッフも拒否されるので、許可したネットワークから開くように伝えてください。

## ボット対策のチャレンジ

パスの手前に置くボット対策のチャレンジやログインの要求は、応答できないクライアントをすべて拒否するWAFの機能です。モバイルアプリもWebhookのプロバイダーも応答できないので、公開APIと画像とWebhookには置かないでください。

## 自分で運用するプロキシ

[設定例](../../2-deployments/4-edge/1-sample-configurations.md)には、どれもWAFは含まれていません。自分で運用するプロキシにModSecurityやCorazaのようなWAFのモジュールを組み込んでOWASP Core Rule Setを使う場合も、上と同じ例外が必要です。
