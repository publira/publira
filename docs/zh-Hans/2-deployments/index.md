---
title: 部署
description: Publira安装实例如何组成，以及如何投入使用。
published: 2026-11-03
source_updated: 2026-10-22
---

这些页面写给部署Publira的运营人员。它们说明安装实例运行什么、依赖什么；至于这些部分如何托管——一个Compose文件、一个Kubernetes集群，还是一组systemd单元——由您自行选择。

## 本节内容

- [概览](./1-overview.md)：安装实例运行的进程、这些进程依赖的服务，以及可以添加的进程。
- [安装](./2-installing.md)：让一个空的安装实例投入使用，从它依赖的服务一直到首次登录租户控制台。
- [Docker Compose](./3-docker-compose.md)：使用仓库中的Compose文件，在一台主机上运行完整的安装实例。
- [边缘](./4-edge/index.md)：安装实例前面的负载均衡器、代理或CDN需要做什么，以及添加租户时需要在上面修改什么。
  - [示例配置](./4-edge/1-sample-configurations.md)：仓库中实现这些要求的Traefik、nginx和Caddy示例配置，以及如何让其中一个适配您的安装实例。
- [Kubernetes](./5-kubernetes/index.md)：在Kubernetes集群上运行安装实例，从Secret、Job和Deployment一直到首次登录。
  - [Kubernetes上的边缘](./5-kubernetes/1-edge.md)：在Service前面放置Gateway或Ingress，并由cert-manager签发证书。
  - [在Kubernetes上运维](./5-kubernetes/2-operating.md)：添加租户、让控制台的凭据远离租户的域名、指标，以及升级。
- [Fargate上的Amazon ECS](./6-ecs-fargate/index.md)：将安装实例作为Fargate上的ECS服务运行，从参数、一次性任务和位于Application Load Balancer后面的服务一直到首次登录。
  - [ECS前方的CloudFront](./6-ecs-fargate/1-cloudfront.md)：以VPC源站的方式在负载均衡器前面放置CloudFront。
  - [在ECS上运维](./6-ecs-fargate/2-operating.md)：添加租户、让控制台的凭据远离租户的域名，以及升级。
- [横向扩展](./7-scaling-out.md)：运行每个进程的多个副本、按所应答的流量拆分`publira server`，以及这些副本共享什么。
- [升级](./8-upgrading.md)：将运行中的安装实例升级到新版本，以及迁移失败时该怎么办。
- [备份与恢复](./9-backup-and-restore.md)：安装实例保存了什么、如何备份，以及如何在空的服务上恢复它。
- [版本发布](./10-releases.md)：`0.x`版本号告诉您什么、次版本和补丁版本可能带来哪些变化，以及哪些版本会获得修复。

如果您还没有读过Publira是什么，请从[入门](../1-getting-started.md)开始。
