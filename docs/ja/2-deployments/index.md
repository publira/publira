---
title: デプロイ
description: Publiraを構成するものと、Publiraを稼働させるまでの手順を説明します。
published: 2026-10-29
source_updated: 2026-10-22
---

このセクションは、Publiraをデプロイするオペレーターに向けたものです。Publiraで動かすものと、Publiraが依存するものを説明します。それらをComposeファイルで動かすか、Kubernetesクラスターで動かすか、systemdのユニットとして動かすかは自由に選べます。

## このセクションの内容

- [構成の概要](./1-overview.md)は、Publiraで動かすプロセス、それらが依存するサービス、あとから追加できるプロセスを説明します。
- [インストール](./2-installing.md)は、空の状態のPubliraを稼働させる手順です。依存するサービスの準備から、テナント管理画面への最初のログインまでを扱います。
- [Docker Compose](./3-docker-compose.md)は、リポジトリにあるComposeファイルを使って、1台のホストでPublira全体を動かす方法を説明します。
- [リバースプロキシの設定](./4-edge/index.md)は、Publiraの前に置くロードバランサー、プロキシ、CDNに必要な設定と、テナントを追加したときに変える箇所を説明します。
  - [リバースプロキシの設定例](./4-edge/1-sample-configurations.md)は、その設定を満たすTraefik、nginx、Caddyの設定例をリポジトリから紹介し、自分の環境に合わせる方法を説明します。
- [Kubernetes](./5-kubernetes/index.md)は、KubernetesクラスターでPubliraを動かす方法です。Secret、Job、Deploymentの作成から最初のログインまでを扱います。
  - [Kubernetesでのリバースプロキシの設定](./5-kubernetes/1-edge.md)は、Serviceの前にGatewayかIngressを置き、cert-managerで証明書を発行する構成を説明します。
  - [Kubernetesでの運用](./5-kubernetes/2-operating.md)は、テナントの追加、管理画面の認証情報をテナントのドメインに送らないための設定、メトリクス、アップグレードを説明します。
- [Amazon ECS(Fargate)](./6-ecs-fargate/index.md)は、PubliraをFargate上のECSサービスとして動かす方法です。パラメーターの用意、単発で実行するタスク、Application Load Balancerの背後に置くサービスから、最初のログインまでを扱います。
  - [CloudFrontを使った公開](./6-ecs-fargate/1-cloudfront.md)は、ロードバランサーをVPCオリジンとして、その前にCloudFrontを置く構成を説明します。
  - [Amazon ECSでの運用](./6-ecs-fargate/2-operating.md)は、テナントの追加、管理画面の認証情報をテナントのドメインに送らないための設定、アップグレードを説明します。
- [スケールアウト](./7-scaling-out.md)は、各プロセスを複数動かす方法、`publira server`を受け持つトラフィックごとに分ける方法、複数のプロセスが共有するものを説明します。
- [アップグレード](./8-upgrading.md)は、稼働中のPubliraを新しいリリースに更新する方法と、マイグレーションが失敗したときの対処を説明します。
- [バックアップと復元](./9-backup-and-restore.md)は、Publiraが保存するもの、そのバックアップの取り方、空のサービスに復元する方法を説明します。
- [リリース](./10-releases.md)は、`0.x`というバージョン番号が意味すること、マイナーリリースとパッチリリースでそれぞれ何が変わりうるか、どのリリースが修正を受けられるかを説明します。

Publiraがどういうものかをまだ読んでいない場合は、[はじめに](../1-getting-started.md)から読んでください。
