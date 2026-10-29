---
title: デプロイ
description: Publiraのインストール環境がどのように構成され、どのように稼働を始めるか。
published: 2026-10-29
source_updated: 2026-10-22
---

このセクションは、Publiraをデプロイするオペレーターに向けたものです。インストール環境が何を動かし、何に依存するかを説明します。それらをどのようにホストするか（Composeファイル、Kubernetesクラスター、systemdユニットの組み合わせなど）は、あなたが選びます。

## このセクションの内容

- [概要](./1-overview.md)：インストール環境が動かすプロセス、それらが依存するサービス、追加できるプロセス。
- [インストール](./2-installing.md)：空のインストール環境を稼働させるまでの手順。依存するサービスの用意から、テナント管理画面への最初のログインまで。
- [Docker Compose](./3-docker-compose.md)：リポジトリのComposeファイルを使って、インストール環境全体を1台のホストで動かす方法。
- [エッジ](./4-edge/index.md)：インストール環境の前に置くロードバランサー、プロキシ、CDNが行うべきこと、そしてテナントを追加したときにそこで変更すること。
  - [サンプル設定](./4-edge/1-sample-configurations.md)：それを行う、リポジトリにあるTraefik、nginx、Caddyのサンプル設定と、それをインストール環境に合わせる方法。
- [Kubernetes](./5-kubernetes/index.md)：Kubernetesクラスターでインストール環境を動かす方法。Secret、Job、Deploymentから最初のログインまで。
  - [Kubernetesでのエッジ](./5-kubernetes/1-edge.md)：Serviceの前に置くGatewayまたはIngressと、証明書を発行するcert-manager。
  - [Kubernetesでの運用](./5-kubernetes/2-operating.md)：テナントの追加、管理画面の認証情報をテナントのドメインから切り離すこと、メトリクス、アップグレード。
- [Fargate上のAmazon ECS](./6-ecs-fargate/index.md)：FargateのECSサービスとしてインストール環境を動かす方法。パラメーター、単発のタスク、Application Load Balancerの背後のサービスから最初のログインまで。
  - [ECSの前に置くCloudFront](./6-ecs-fargate/1-cloudfront.md)：VPCオリジンとして、ロードバランサーの前に置くCloudFront。
  - [ECSでの運用](./6-ecs-fargate/2-operating.md)：テナントの追加、管理画面の認証情報をテナントのドメインから切り離すこと、アップグレード。
- [スケールアウト](./7-scaling-out.md)：各プロセスを複数動かすこと、`publira server`を応答するトラフィックごとに分けること、そして複数のコピーが共有するもの。
- [アップグレード](./8-upgrading.md)：稼働中のインストール環境を新しいリリースに上げる方法と、マイグレーションが失敗したときの対処。
- [バックアップと復元](./9-backup-and-restore.md)：インストール環境が保持するもの、そのバックアップ、空のサービスへの復元。
- [リリース](./10-releases.md)：`0.x`のバージョン番号が示すこと、マイナーリリースとパッチリリースが変更しうること、修正を受けるリリース。

Publiraとは何かをまだ読んでいない場合は、[はじめに](../1-getting-started.md)から読んでください。
