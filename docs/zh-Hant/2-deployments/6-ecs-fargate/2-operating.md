---
title: 在ECS上營運
description: 在AWS Fargate上之Amazon ECS執行的安裝實例中新增租戶、讓主控台的認證資訊遠離租戶的網域、分開提供圖片與公開API，以及升級。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

本頁說明[在AWS Fargate上執行Amazon ECS](./index.md)與[ECS前方的CloudFront](./1-cloudfront.md)讓安裝實例開始提供服務之後，對它所做的變更。其指令會使用那兩頁所定義的shell變數與函式。若不是在建置安裝實例時所用的shell中執行，請重新定義指令中用到的變數與函式：[開始之前](./index.md#開始之前)的變數、[套用遷移並建立資料庫角色](./index.md#4-套用遷移並建立資料庫角色)的`run_publiractl`函式、[開通網路路徑](./index.md#3-開通網路路徑)的`SERVER_SG`、`NAMESPACE`與`registry`函式、[建立負載平衡器](./index.md#5-建立負載平衡器)的`target_group`函式、[啟動服務](./index.md#6-啟動服務)的`service`函式，以及可由`aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`印出的`LISTENER`。

## 新增租戶

以`publiractl tenant create`或在平台主控台中建立的租戶，需要在邊緣上設定它的兩個主機名稱，如[新增租戶](../4-edge/index.md#新增租戶)所述。在ECS上，請在其工作人員開啟主控台之前完成以下步驟：

1. **憑證**。依[建立負載平衡器](./index.md#5-建立負載平衡器)的做法，在負載平衡器所在的區域與`us-east-1`中，各申請一張涵蓋其網域與主控台主機的憑證，並完成兩者的驗證。
2. **負載平衡器**。以`aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`把第一張憑證加入listener，並加入兩條規則：依該處的表格，把其網域與主控台主機各自放在`2000`區段。除非您提高配額，否則負載平衡器在listener的預設憑證之外最多可容納25張憑證與100條規則；規則的主機條件最多可指定三個名稱，因此每條規則最多可由三個租戶共用。
3. **CloudFront**。以[分佈](./1-cloudfront.md#分佈)的`distribution.json`建立它專屬的分佈，在`Aliases`中填入其兩個名稱，在`ViewerCertificate`中填入其`us-east-1`憑證，並使用專屬的`CallerReference`。VPC來源、函式與快取政策則與第一個分佈所用的相同。
4. **DNS**。把兩個名稱指向新分佈的網域名稱。

其他都不需要變更：服務、參數與安全群組對每個租戶都一視同仁。

## 讓主控台的認證資訊遠離租戶的網域

負載平衡器已經讓主控台的API不暴露於網際網路（API金鑰可進行的讀取除外），但它把租戶網域轉送過去的`publira-server`仍然提供這些API，並為此持有它們的資料庫登入與Web服務權杖。若要把這三者都移出讀者會接觸到的處理程序，作為與邊緣規則不同的另一層防護（如[只有公開API經過邊緣](../4-edge/index.md#只有公開api經過邊緣)所述），請以`--role storefront`執行第二個服務，並把租戶的網域與`web-storefront`路由到它。這樣拆分也能讓讀者的流量與主控台分開擴充，因為每個服務都執行自己的任務，如[依角色拆分伺服器](../7-scaling-out.md#依角色拆分伺服器)所述。

它的任務定義是[啟動服務](./index.md#6-啟動服務)中的`publira-server.json`，但family與容器名稱改為`publira-storefront`，指令改為`["server", "--role", "storefront"]`，並且只保留該角色會讀取的密鑰：加密金鑰、`PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_REVALIDATE_TOKEN`、`PUBLIRA_REDIS_URL`與`PUBLIRA_PUBLIC_DB_URL`。註冊它，並為它建立專屬的目標群組與Cloud Map名稱，因為除了負載平衡器之外，`web-storefront`也會呼叫它：

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

接著，在伺服器的規則之前加入規則，把租戶的網域送往它：

| 優先順序 | 主機 | 路徑 | 轉送至 |
| --- | --- | --- | --- |
| `900`至`999` | 租戶的網域 | `/images*`、`/rpc/publira.v1.*` | `publira-storefront` |

規則最多可有五個值，扣除兩個路徑後還剩三個主機名稱的空間，因此這個區段中的每條規則最多服務三個租戶的網域：請把新租戶的網域加入已指定網域的規則，或在該區段中下一個可用的優先順序為它建立專屬的規則。

目標群組是透過規則附加到負載平衡器的，而ECS會拒絕建立目標群組未附加到任何負載平衡器的服務，因此規則必須先於服務建立。不過，在服務的任務啟動之前，新的目標群組沒有任何東西可以回應，因此建立每條規則時，仍讓它轉送到`publira-server`，並把`publira-storefront`以權重`0`並列。接著以已允許Web應用程式連入的`publira-server`安全群組建立服務，待其任務都健康後，再讓規則只轉送到它：

```bash
RULE_900=$(aws elbv2 create-rule --listener-arn "$LISTENER" --priority 900 \
  --conditions "[$(host_is comics.example.com),$(path_is '["/images*","/rpc/publira.v1.*"]')]" \
  --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$SERVER_TG,Weight=1},{TargetGroupArn=$STOREFRONT_SERVER_TG,Weight=0}]}" \
  --query 'Rules[0].RuleArn' --output text)
service publira-storefront "$SERVER_SG" 8000 "$STOREFRONT_SERVER_TG"
aws ecs wait services-stable --cluster publira --services publira-storefront
aws elbv2 modify-rule --rule-arn "$RULE_900" \
  --actions "Type=forward,TargetGroupArn=$STOREFRONT_SERVER_TG" > /dev/null
```

`host_is`與`path_is`是[建立負載平衡器](./index.md#5-建立負載平衡器)中的函式，`SERVER_TG`則是在那裡建立的目標群組；在其他shell中，`aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`會印出它。服務執行後才加入該區段的規則，則以該頁的`rule`函式建立，只轉送到`publira-storefront`。

`web-storefront`只呼叫公開API，因此也讓它指向新的服務：在`web-storefront.json`中把`PUBLIRA_GRPC_URL`設為`http://publira-storefront.publira.internal:8000/rpc`，註冊它，並把`web-storefront`服務更新為新的修訂版本。主控台主機、`web-admin`與`web-platform`則繼續存取提供所有角色的`publira-server`，直到[讓主控台的伺服器不提供公開API](#讓主控台的伺服器不提供公開api)把公開API從它身上移除。

無論如何，負載平衡器都會在每個主機上對大部分主控台API回應`404`，因此改為確認租戶的網域已抵達新的服務：`aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`會把其任務列為`healthy`，而[檢查邊緣](./1-cloudfront.md#檢查邊緣)中的公開API呼叫在租戶的網域上仍會回應`invalid_argument`，只是現在是由`publira-storefront`回應。

### 讓主控台的伺服器不提供公開API

`publira-server`仍然提供公開API並持有`publira_public`，因為`web-admin`會呼叫公開API來取得租戶的主題與標籤，而`1000`的規則也會把主控台主機的公開API轉送到那裡。把這兩者都送往`publira-storefront`後，`publira-server`就能以`--role admin,platform`執行，如[依角色拆分伺服器](../7-scaling-out.md#依角色拆分伺服器)的第4步所述。請依以下順序進行變更，這樣在`publira-server`停止提供公開API時，就不會再有任何東西向它傳送公開API請求。

首先，讓`web-admin`的公開API呼叫指向storefront服務。在`web-admin.json`的`environment`中、於`PUBLIRA_GRPC_URL`（仍指定`publira-server`）旁加入此變數：

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

然後部署它：

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

此後它的`/readyz`也會以`public-api`的名稱檢查該服務。

接著，把每個主機的公開API路由到`publira-storefront`（它在任何主機上都會回應），並讓主控台主機的`/images`留在`publira-server`，因為主控台頁面所顯示的圖片屬於`admin`角色。在`1000`的規則之後加入公開API的規則，再從`1000`的規則中移除公開API，讓公開API不再抵達`publira-server`：

| 優先順序 | 主機 | 路徑                | 轉送至               |
| -------- | ---- | ------------------- | -------------------- |
| `1000`   | 任意 | `/images*`          | `publira-server`     |
| `1050`   | 任意 | `/rpc/publira.v1.*` | `publira-storefront` |

```bash
rule 1050 "[$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
RULE_1000=$(aws elbv2 describe-rules --listener-arn "$LISTENER" \
  --query "Rules[?Priority=='1000'].RuleArn" --output text)
aws elbv2 modify-rule --rule-arn "$RULE_1000" \
  --conditions "[$(path_is '["/images*"]')]" > /dev/null
```

`rule`與`path_is`是[建立負載平衡器](./index.md#5-建立負載平衡器)中的函式，`STOREFRONT_SERVER_TG`則是上方建立的目標群組；在其他shell中，`aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`會印出它。`900`區段中的規則會繼續把租戶的網域（包括公開API）轉送到`publira-storefront`。

最後，在`publira-server.json`中把容器的`command`設為`["server", "--role", "admin,platform"]`，並從其`secrets`中移除`PUBLIRA_PUBLIC_DB_URL`（處理程序已不再讀取它），然後部署：

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

登入租戶主控台：它會和先前一樣顯示租戶的主題並列出標籤，只是現在是從`publira-storefront`讀取。把[檢查邊緣](./1-cloudfront.md#檢查邊緣)中的公開API呼叫送往主控台主機`https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`，仍會回應`invalid_argument`；若在那裡得到`404`，表示主控台主機的公開API仍抵達`publira-server`。

## 分開提供圖片與公開API

租戶的圖片與公開API可以使用各自的主機名稱，並各自經由自己的負載平衡器存取，如[分開提供圖片與公開API](../7-scaling-out.md#分開提供圖片與公開api)所述。在ECS上，圖片會在專屬的服務前方有第二個內部負載平衡器與一個CloudFront分佈，而公開API則是在既有負載平衡器上、位於`publira-storefront`前方的一個主機名稱。這是建立在建立了`publira-storefront`的[讓主控台的認證資訊遠離租戶的網域](#讓主控台的認證資訊遠離租戶的網域)之上。以下名稱為範例：`images.comics.example.com`是租戶的圖片主機，`api.example.com`是公開API的主機。

### 圖片

讓圖片在專屬的服務上執行，使其流量能與API分開擴充。其任務定義是`publira-images.json`，內容為`publira-storefront.json`，但family與容器名稱改為`publira-images`：兩者提供相同的角色，讀取相同的密鑰。註冊它，並為它建立目標群組與Cloud Map名稱，`service`函式會以該名稱註冊它：

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

依[建立負載平衡器](./index.md#5-建立負載平衡器)的做法，在負載平衡器所在的區域與`us-east-1`中申請涵蓋圖片主機的憑證，並完成驗證。接著以第一個負載平衡器的安全群組（CloudFront的VPC來源與`publira-server`安全群組都已獲允許）建立第二個內部負載平衡器，以及一個HTTPS listener，其唯一的規則把`/images`轉送到新的服務，其他一律回應`404`：

```bash
IMAGES_ALB=$(aws elbv2 create-load-balancer --name publira-images --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
IMAGES_LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$IMAGES_ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the image hosts' certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 create-rule --listener-arn "$IMAGES_LISTENER" --priority 1000 \
  --conditions "[$(path_is '["/images*"]')]" \
  --actions "Type=forward,TargetGroupArn=$IMAGES_TG" > /dev/null
```

目標群組是透過規則附加到負載平衡器的，而ECS會拒絕目標群組未附加到任何負載平衡器的服務，因此直到現在才建立服務：

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

以[ECS前方的CloudFront](./1-cloudfront.md)在第一個負載平衡器前方設置CloudFront的方式，在它前方設置CloudFront：依[VPC來源](./1-cloudfront.md#vpc來源)為`$IMAGES_ALB`建立VPC來源，並以[分佈](./1-cloudfront.md#分佈)的`distribution.json`建立分佈，在`Aliases`中填入圖片主機，在`ViewerCertificate`中填入其`us-east-1`憑證，在`Origins`中填入新負載平衡器的DNS名稱與新VPC來源的ID，並使用專屬的`CallerReference`。函式與`publira-images`快取政策與第一個分佈所用的相同，其`/images*`行為也會像在那裡一樣快取圖片。`publira-images.json`帶有[用戶端位址](./1-cloudfront.md#用戶端位址)中的`PUBLIRA_TRUSTED_PROXIES`，它同樣涵蓋這個分佈與這個負載平衡器。

分佈部署完成後，把每個圖片主機指向其網域名稱，然後在平台主控台的**圖片主機**中，或以`publiractl tenant update --image-domain`，將圖片主機指定給租戶，如[圖片主機](../../3-operations/2-tenants.md#圖片主機)所述。之後新增的租戶，其圖片主機必須包含在新listener上的某張憑證中（以`aws elbv2 add-listener-certificates`加入），並加入新分佈或其專屬分佈的`Aliases`。

### 公開API

在既有的負載平衡器上為公開API設置專屬的主機名稱。在兩個區域中為`api.example.com`申請憑證，把負載平衡器所在區域的那一張加入其listener，並在`900`區段中加入一條規則，把該主機上的公開API轉送到`publira-storefront`：

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

請在該區段中選用尚未被任何規則使用的優先順序。該主機上的其他所有路徑都會得到listener的`404`，只有`/images`例外：`1000`的規則會在每個主機上把它送往`publira-server`，而由於該主機不屬於任何租戶，那裡同樣會回應`404`。接著以`distribution.json`為它建立分佈，在`Aliases`中填入`api.example.com`，在`ViewerCertificate`中填入其`us-east-1`憑證，並使用專屬的`CallerReference`，然後把`api.example.com`指向該分佈的網域名稱。

Web應用程式已經透過VPC呼叫`publira-storefront`，不經過任何一個負載平衡器：`web-storefront`透過`PUBLIRA_GRPC_URL`，`web-admin`則在完成[讓主控台的伺服器不提供公開API](#讓主控台的伺服器不提供公開api)後透過`PUBLIRA_PUBLIC_GRPC_URL`。在VPC外部執行的Web應用程式則改為指定`https://api.example.com/rpc`。租戶有了圖片主機之後，請以`PUBLIRA_BASE_URL=https://api.example.com`建置租戶的行動應用程式，如[應用程式連線的位址](../../5-mobile-app/2-building.md#應用程式連線的位址)所述。租戶的網域維持原有的規則，因此以租戶網域建置的應用程式仍可繼續運作。

### 檢查拆分結果

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

第一個指令會回應`404`：圖片主機只提供圖片。第二個會抵達`publira-storefront`，後者以`invalid_argument`拒絕這個空的請求。第三個也會回應`404`：API的主機不提供圖片。接著開啟租戶的網站：其圖片會從`https://images.comics.example.com/images/…`載入。

## 升級

[升級](../8-upgrading.md)說明如何把安裝實例升級到新版本：備份、以新版本的`publiractl`執行遷移與建立角色，然後是處理程序。請先閱讀該頁及該版本的版本說明。在ECS上，其步驟如下：

以下每個步驟都會作用於安裝實例執行的每個服務。請先一次列出它們；若有執行`web-platform`、`email-renderer`、`publira-storefront`與`publira-images`，也一併加入：

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **停止服務**（若您決定先停止它們，判斷依據見[決定是否先停止處理程序](../8-upgrading.md#決定是否先停止處理程序)），做法是先記下每個服務執行的任務數，再把每個服務的任務數設為零：

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **備份資料庫**：為RDS執行個體或Aurora叢集建立快照，或從能連線到資料庫的主機執行`pg_dump`，如[備份資料庫](../8-upgrading.md#1-備份資料庫)所述。
3. **套用遷移與角色**：把`publiractl-db-migrate.json`與`publiractl-db-roles.json`中的`<tag>`改為新版本，註冊兩者，並以`run_publiractl`依此順序執行，每一個成功後才繼續。角色的任務會為每個角色設定其參數中保存的密碼，也就是它目前已有的密碼，因此不需變更即可執行。若某個版本新增了角色，則需要一個存放該角色密碼的參數、一個把它設為變數的`secrets`項目，以及指定該變數的旗標。
4. **啟動新版本**：在每個服務的任務定義中變更`<tag>`，加入版本說明所列的變數，註冊它們，並把每個服務更新為新的修訂版本；若您在第1步停止了服務，也一併把任務數恢復為先前的數量，也就是該步驟記在`COUNT`中的值：

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **檢查安裝實例**，如[檢查安裝實例](../8-upgrading.md#5-檢查安裝實例)所述。

若改為在升級期間讓服務持續執行，第4步會依[替換處理程序](../8-upgrading.md#4-替換處理程序)所列的順序替換它們。若有執行`email-renderer`，請先更新它，再以只列出其他服務的`SERVICES`執行第4步的迴圈；ECS會一次替換少數幾個任務，而安裝實例在此期間持續提供服務。
