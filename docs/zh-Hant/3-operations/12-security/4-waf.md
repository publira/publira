---
title: Web應用程式防火牆
description: 安裝實例前方的Web應用程式防火牆能增加什麼、要開啟哪些受管規則、除非設定例外否則會被它們拒絕的Publira請求，以及將主控台限制在您自己的網路中。
published: 2026-11-03
updated: 2026-11-06
source_updated: 2026-11-06
---

位於邊緣前方的Web應用程式防火牆（WAF）會檢查每個請求，並在請求到達您執行的任何東西之前，拒絕看起來像攻擊的請求，例如SQL注入、跨網站指令碼、路徑周遊，以及針對常見軟體已知漏洞的探測。Publira的安全並不依賴WAF。WAF是位於Publira自身檢查之前的一層防護，它還能擋下掃描工具，以及在升級修正漏洞之前針對該漏洞的攻擊，並在您的工作人員從已知網路工作時，讓主控台不暴露在網際網路上。

雲端平台上的安裝實例幾乎總是有代管的負載平衡器或CDN位於其前方，應該使用的就是它們的WAF：CloudFront或Application Load Balancer上的AWS WAF、Google Cloud負載平衡器上的Cloud Armor，或Cloudflare。同一個WAF還能限制單一用戶端可以傳送的請求數，如[速率限制](./5-rate-limits.md)所述。

## 開啟受管規則

每個WAF都附帶由其供應商維護、針對常見攻擊的規則集。請開啟以下規則集：

| WAF | 規則集 |
| --- | --- |
| AWS WAF | 在CloudFront分佈或負載平衡器的Web ACL中，開啟[核心規則集](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)（`AWSManagedRulesCommonRuleSet`）、已知不良輸入（`AWSManagedRulesKnownBadInputsRuleSet`），以及[SQL資料庫](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html)規則群組（`AWSManagedRulesSQLiRuleSet`） |
| Google Cloud Armor | 在負載平衡器後端服務的安全性政策中，開啟OWASP Core Rule Set 4.22的[預先設定WAF規則](https://cloud.google.com/armor/docs/waf-rules)，至少包括`sqli-v422-stable`、`xss-v422-stable`、`lfi-v422-stable`、`rfi-v422-stable`、`rce-v422-stable`、`protocolattack-v422-stable`和`scannerdetection-v422-stable`。從誤判最少的敏感度1開始，等日誌乾淨之後再調高 |
| Cloudflare | Pro以上方案的[Cloudflare Managed Ruleset和Cloudflare OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/)，或Free方案的Cloudflare Free Managed Ruleset |

拒絕讀者或服務商合法請求的規則，與停機一樣會讓安裝實例無法運作，因此請先讓每條規則只記錄而不拒絕：在AWS WAF中將其動作覆寫為Count，在Cloud Armor中則使用預覽模式。在實際流量中檢視它原本會拒絕的內容，為它攔到的內容設定下述例外，然後才讓它拒絕。

## 受管規則會拒絕的請求

這些規則集是為一般的Web應用程式撰寫的，而Publira提供的部分內容並非如此：

| 請求 | 帶有的內容 | 拒絕它們的規則 | 處理方式 |
| --- | --- | --- | --- |
| 上傳：主控台主機上的`/api/v1/episode-pages`與`/api/v1/series-import`、`/api/v1/`的其餘部分、上傳圖片的頁面，以及傳送到公開API的讀者圖示 | 分別最多256 MiB、33 MiB、11 MiB和15 MiB的主體，如[租戶主控台中的上傳](../../2-deployments/4-edge/index.md#租戶主控台中的上傳)和[從頁面上傳圖片](../../2-deployments/4-edge/index.md#從頁面上傳圖片)所述 | AWS WAF的`SizeRestrictions_BODY`，它會拒絕所有超過8 KB的主體 | 將該規則設為Count；真正重要的是邊緣本身對主體大小的限制 |
| `/api/v1/webhook/`下的Webhook | 付款服務商的事件，或讀者以電子郵件回覆的完整內容，包括其HTML和附件 | 針對跨網站指令碼、SQL注入和檔案引入的主體規則，郵件的HTML和文字會觸發它們 | 在此路徑上略過受管規則。Publira會檢查每個服務商在主體上附加的簽章，因此即使沒有這些規則，偽造的請求也會被拒絕，而被拒絕的請求會被重試然後遺失，如[Webhook](../../2-deployments/4-edge/index.md#webhook)所述 |
| 讀者和工作人員撰寫的內容：留言、聯絡訊息，以及主控台主機上的頁面、公告和回覆 | 可能引用程式碼的文字，例如讀者詢問為何標題中會出現`<b>` | 針對跨網站指令碼和SQL注入的主體規則 | 保留這些規則。若日誌顯示它們拒絕了這類文字，請降低造成拒絕的規則的敏感度，或只在只有已登入工作人員會撰寫內容的主控台主機上略過該規則 |

行動應用程式以二進位Protocol Buffers（`application/proto`）將請求傳送到公開API，其文字欄位會以讀者輸入的位元組形式到達WAF，因此主體規則會像讀取表單一樣讀取它們。

WAF只會檢查主體的開頭部分：在AWS WAF中，預設在Application Load Balancer上為8 KB，在CloudFront上為16 KB；在Cloud Armor中最多64 KB；在Cloudflare中，Free方案為1 MB，Enterprise方案為128 KB。請將AWS WAF對超出該範圍的主體的處理方式保留為Continue，它會檢查限制內的部分：若在會封鎖的規則上設為Match，則會拒絕所有上傳。

## 將主控台限制在您的網路中

主控台主機只為您的工作人員和營運人員提供服務：讀者、行動應用程式和所有Webhook都只會到達租戶的網站，絕不會到達主控台主機。當您的工作人員從已知的網路（例如辦公室或VPN）工作時，請只允許這些位址存取主控台主機，方法是在AWS WAF中使用IP集合、在Cloud Armor中使用比對來源位址的規則，或在Cloudflare中使用自訂規則，這樣主控台的登入頁面就不會暴露在網際網路上。從其他地方開啟邀請或密碼重設的工作人員也會被拒絕，因此請告訴他們使用主控台所允許的網路。

## 機器人驗證

路徑前方的機器人驗證或登入提示，是一種會拒絕所有無法回應它的用戶端的WAF功能，而行動應用程式和Webhook服務商都無法回應。請讓兩者都不要用在公開API、圖片和Webhook上。

## 您執行的代理伺服器

[設定範例](../../2-deployments/4-edge/1-sample-configurations.md)都沒有附帶WAF。用於您自行執行之代理伺服器的WAF模組，例如搭配OWASP Core Rule Set的ModSecurity或Coraza，也需要上述相同的例外。
