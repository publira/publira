---
title: 部署
description: Publira安裝實例的組成方式，以及如何讓它開始提供服務。
published: 2026-11-03
source_updated: 2026-10-22
---

這些頁面是寫給部署Publira的營運人員。內容說明安裝實例執行哪些部分、依賴哪些服務；至於這些部分如何託管，例如使用Compose檔案、Kubernetes叢集或一組systemd單元，則由您決定。

## 本節內容

- [概觀](./1-overview.md)：安裝實例執行的處理程序、它們依賴的服務，以及可以額外加入的處理程序。
- [安裝](./2-installing.md)：讓一個空的安裝實例開始提供服務，從它依賴的服務到首次登入租戶主控台。
- [Docker Compose](./3-docker-compose.md)：使用儲存庫中的Compose檔案，在單一主機上執行整個安裝實例。
- [邊緣](./4-edge/index.md)：安裝實例前方的負載平衡器、代理伺服器或CDN必須做的事，以及新增租戶時要在其上變更的設定。
  - [設定範例](./4-edge/1-sample-configurations.md)：儲存庫中能做到這些事的Traefik、nginx與Caddy設定範例，以及如何將其調整為適合您的安裝實例。
- [Kubernetes](./5-kubernetes/index.md)：在Kubernetes叢集上執行安裝實例，從Secret、Job與Deployment到首次登入。
  - [Kubernetes上的邊緣](./5-kubernetes/1-edge.md)：在Service前方放置Gateway或Ingress，並由cert-manager簽發憑證。
  - [在Kubernetes上營運](./5-kubernetes/2-operating.md)：新增租戶、讓主控台的認證資訊不出現在租戶的網域上、指標，以及升級。
- [在AWS Fargate上執行Amazon ECS](./6-ecs-fargate/index.md)：將安裝實例作為Fargate上的ECS服務執行，從參數、一次性任務、Application Load Balancer後方的服務，到首次登入。
  - [ECS前方的CloudFront](./6-ecs-fargate/1-cloudfront.md)：以VPC來源的方式，在負載平衡器前方放置CloudFront。
  - [在ECS上營運](./6-ecs-fargate/2-operating.md)：新增租戶、讓主控台的認證資訊不出現在租戶的網域上，以及升級。
- [水平擴展](./7-scaling-out.md)：為每個處理程序執行多個副本、依照所處理的流量拆分`publira server`，以及這些副本共用的部分。
- [升級](./8-upgrading.md)：將運作中的安裝實例更新至新版本，以及遷移失敗時該怎麼做。
- [備份與還原](./9-backup-and-restore.md)：安裝實例保存的內容、如何備份，以及如何在空的服務上將其還原。
- [版本](./10-releases.md)：`0.x`版本號代表什麼、次要版本與修補版本可能變更的內容，以及哪些版本會收到修正。

如果您還沒讀過Publira是什麼，請從[快速入門](../1-getting-started.md)開始。
