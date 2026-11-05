---
title: Web应用防火墙
description: 安装实例前面的Web应用防火墙能增加什么、应开启哪些托管规则、除非设置例外否则会被这些规则拒绝的Publira请求，以及将控制台限制在您自己的网络中。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

位于边缘前面的Web应用防火墙（WAF）会检查每个请求，并在请求到达您运行的任何东西之前，拒绝看起来像攻击的请求，例如SQL注入、跨站脚本、路径遍历，以及针对常见软件已知漏洞的探测。Publira的安全并不依赖于WAF。WAF是Publira自身检查之前的一道防护层，它还能挡住扫描器，以及在升级修复漏洞之前针对该漏洞的攻击；当您的工作人员从您所知的网络工作时，它还能让控制台不暴露在互联网上。

云平台上的安装实例前面几乎总有托管的负载均衡器或CDN，应使用的就是它们的WAF：CloudFront或Application Load Balancer上的AWS WAF、Google Cloud负载均衡器上的Cloud Armor，或者Cloudflare。同一个WAF还可以限制单个客户端能发送的请求数，详见[速率限制](./5-rate-limits.md)。

## 开启托管规则

每个WAF都附带由其供应商维护的、针对常见攻击的规则集。请开启以下规则集：

| WAF | 规则集 |
| --- | --- |
| AWS WAF | 在CloudFront分配或负载均衡器的Web ACL中开启[核心规则集](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)（`AWSManagedRulesCommonRuleSet`）、已知不良输入（`AWSManagedRulesKnownBadInputsRuleSet`）以及[SQL数据库](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html)规则组（`AWSManagedRulesSQLiRuleSet`） |
| Google Cloud Armor | 在负载均衡器后端服务的安全策略中开启OWASP Core Rule Set 4.22的[预配置WAF规则](https://cloud.google.com/armor/docs/waf-rules)，至少包括`sqli-v422-stable`、`xss-v422-stable`、`lfi-v422-stable`、`rfi-v422-stable`、`rce-v422-stable`、`protocolattack-v422-stable`和`scannerdetection-v422-stable`。从误报最少的敏感度1开始，日志干净后再提高 |
| Cloudflare | Pro及以上套餐开启[Cloudflare Managed Ruleset和Cloudflare OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/)，Free套餐开启Cloudflare Free Managed Ruleset |

拒绝读者或服务商正当请求的规则，与故障一样会让安装实例无法正常工作，因此请先让每条规则只记录而不拒绝：在AWS WAF中将其操作覆盖为Count，在Cloud Armor中使用预览模式。在真实流量下查看它本会拒绝哪些请求，针对它拦截到的内容设置下面的例外，然后才让它真正拒绝。

## 托管规则会拒绝的请求

这些规则集是为常见的Web应用编写的，而Publira提供的部分内容并非如此：

| 请求 | 携带的内容 | 拒绝它们的规则 | 应对方法 |
| --- | --- | --- | --- |
| 上传：控制台主机上的`/api/v1/episode-pages`、`/api/v1/`下的其余路径、上传图片的页面，以及发送到公开API的读者图标 | 最大分别为256 MiB、33 MiB、11 MiB和15 MiB的请求正文，详见[租户控制台中的上传](../../2-deployments/4-edge/index.md#租户控制台中的上传)和[从页面上传图片](../../2-deployments/4-edge/index.md#从页面上传图片) | AWS WAF的`SizeRestrictions_BODY`，它会拒绝所有超过8 KB的请求正文 | 将该规则设为Count；真正起作用的是边缘自身对请求正文大小的限制 |
| `/api/v1/webhook/`下的Webhook | 支付服务商的事件，或读者通过邮件发送的完整回复，包括其HTML和附件 | 针对跨站脚本、SQL注入和文件包含的请求正文规则，邮件的HTML和文本会触发这些规则 | 在此路径上跳过托管规则。Publira会检查每个服务商在请求正文上附加的签名，因此即使没有这些规则，伪造的请求也会被拒绝；而被拒绝的请求会被重试，然后丢失，详见[Webhook](../../2-deployments/4-edge/index.md#webhook) |
| 读者和工作人员撰写的内容：评论、联系留言，以及控制台主机上的页面、公告和回复 | 可能引用代码的文本，例如读者询问为什么标题中会出现`<b>` | 针对跨站脚本和SQL注入的请求正文规则 | 保留这些规则。如果日志显示它们拒绝了这类文本，请降低拒绝它的那条规则的敏感度，或者只在控制台主机上跳过该规则，因为那里只有已登录的工作人员撰写内容 |

移动应用以二进制Protocol Buffers（`application/proto`）向公开API发送请求，其文本字段以读者输入的字节到达WAF，因此请求正文规则会像读取表单一样读取它们。

WAF只检查请求正文的开头部分：在AWS WAF中，默认在Application Load Balancer上为8 KB，在CloudFront上为16 KB；在Cloud Armor中最多为64 KB；在Cloudflare中，Free套餐为1 MB，Enterprise为128 KB。请将AWS WAF对超出该长度的请求正文的处理方式保持为Continue，它会检查限制范围内的部分：在执行拦截的规则上设为Match，会拒绝所有上传。

## 将控制台限制在您的网络中

控制台主机只为您的工作人员和运营人员提供服务：读者、移动应用和所有Webhook访问的都是租户的网站，而绝不是控制台主机。当您的工作人员从您所知的网络（例如办公室或VPN）工作时，请只允许这些地址访问控制台主机：在AWS WAF中使用IP集，在Cloud Armor中使用匹配源地址的规则，在Cloudflare中使用自定义规则，这样控制台的登录页面就不会暴露在互联网上。从其他地方打开邀请或密码重置的工作人员也会被拒绝，因此请告诉他们使用控制台允许的网络。在控制台主机上调用[API密钥可调用的读取请求](../../2-deployments/4-edge/index.md#api密钥可调用的读取请求)的租户自有系统同样会被拒绝，因此请添加其地址，或者将这些路径排除在该规则之外。

## 机器人质询

路径前面的机器人质询或登录提示是WAF的一项功能，它会拒绝所有无法应答的客户端，而移动应用和Webhook服务商都无法应答。请不要在公开API、图片和Webhook上使用这两者。

## 您运行的代理

所有[示例配置](../../2-deployments/4-edge/1-sample-configurations.md)都不带WAF。用于您所运行代理的WAF模块，例如搭配OWASP Core Rule Set的ModSecurity或Coraza，需要设置与上面相同的例外。
