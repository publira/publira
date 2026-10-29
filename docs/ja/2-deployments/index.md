---
title: デプロイ
description: Publiraの構成と、Publiraを稼働させるまでの手順を説明します。
published: 2026-10-29
source_updated: 2026-10-22
---

このセクションは、Publiraをデプロイするオペレーター向けです。Publiraで動かすものと、Publiraが依存するものを説明します。それらをどのようにホストするか(Composeファイル、Kubernetesクラスター、systemdユニット群など)は自由に選べます。

## このセクションの内容

- [構成の概要](./1-overview.md)では、Publiraで動かすプロセス、それらが依存するサービス、追加できるプロセスを説明します。
- [インストール](./2-installing.md)では、空の状態からPubliraを稼働させる手順を、依存するサービスの準備からテナント管理画面への最初のログインまで説明します。
- [Docker Compose](./3-docker-compose.md)では、リポジトリにあるComposeファイルを使い、1台のホストでPublira全体を動かす方法を説明します。
- [リバースプロキシの設定](./4-edge/index.md)では、Publiraの前に置くロードバランサーやプロキシ、CDNに必要な設定と、テナントを追加したときに変更する箇所を説明します。
  - [リバースプロキシの設定例](./4-edge/1-sample-configurations.md)では、その設定を実装したリポジトリ内のTraefik、nginx、Caddyのサンプル設定と、それを自分の環境に合わせる方法を説明します。
- [Kubernetes](./5-kubernetes/index.md)では、Kubernetesクラスター上でPubliraを動かす方法を、Secret、Job、Deploymentの作成から最初のログインまで説明します。
  - [Kubernetesでのリバースプロキシの設定](./5-kubernetes/1-edge.md)では、Serviceの前にGatewayかIngressを置き、cert-managerで証明書を発行する構成を説明します。
  - [Kubernetesでの運用](./5-kubernetes/2-operating.md)では、テナントの追加、管理画面の認証情報をテナントのドメインに送らないための設定、メトリクス、アップグレードを説明します。
- [Amazon ECS(Fargate)](./6-ecs-fargate/index.md)では、Fargate上のECSサービスとしてPubliraを動かす方法を説明します。パラメーターの用意、単発のタスク、Application Load Balancerの背後に置くサービスから、最初のログインまでを扱います。
  - [CloudFrontを使った公開](./6-ecs-fargate/1-cloudfront.md)では、ロードバランサーの前にCloudFrontをVPCオリジン経由で置く構成を説明します。
  - [Amazon ECSでの運用](./6-ecs-fargate/2-operating.md)では、テナントの追加、管理画面の認証情報をテナントのドメインに送らないための設定、アップグレードを説明します。
- [スケールアウト](./7-scaling-out.md)では、各プロセスを複数動かす方法、`publira server`を受け持つトラフィックごとに分ける方法、複数のプロセスで共有するものを説明します。
- [アップグレード](./8-upgrading.md)では、稼働中のPubliraを新しいリリースに更新する方法と、マイグレーションが失敗したときの対処を説明します。
- [バックアップと復元](./9-backup-and-restore.md)では、Publiraが保存するデータとそのバックアップ方法、空のサービスへの復元方法を説明します。
- [リリース](./10-releases.md)では、`0.x`というバージョン番号の意味、マイナーリリースとパッチリリースでそれぞれ何が変わりうるか、どのリリースに修正が提供されるかを説明します。

Publiraについてまだ読んでいない場合は、[はじめに](../1-getting-started.md)から読んでください。
