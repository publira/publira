---
title: 移动应用
description: 构建、签名并发布租户自己的iOS和Android应用。
published: 2026-11-03
source_updated: 2026-10-28
---

每个租户都可以用自己的名义发布Publira读者应用：使用自己的启动器名称和商店页面、自己的推送通知，以及在应用中打开的网站链接。这些页面面向构建和发布该应用的人，无论是运营人员还是出版社自己的工作人员，并且不要求了解构建它所用的Flutter代码。

应用是从代码仓库构建的，而不是下载得到的。同一份检出可以构建任何租户的应用：让它成为某个特定租户应用的所有内容，都放在您保存在代码仓库之外的一个小文件（应用清单）中，以及构建时从环境中读取的值中。

## 开始之前

- **租户的网站已投入使用**。应用从租户的公开网站读取所有内容，商店也会根据同一主机检查应用声明的链接。[部署](../2-deployments/index.md)介绍如何让安装实例投入使用。
- **Apple Developer Program会员资格和Google Play Console开发者账户**，属于发布该应用的出版社。两者都是付费的，审批也需要时间，所以请先申请。
- **一个Firebase项目**，用于推送通知。它是免费的。
- **安装实例所运行版本的检出**，以便应用和它调用的API来自同一个版本。
- **一台用于构建应用的机器**。Android可以在Linux、macOS或Windows上构建；iOS只能在装有Xcode的Mac上构建。两者都需要代码仓库所固定版本的Flutter SDK，具体见[前提条件](https://github.com/publira/publira/blob/main/mobile/README.md#prerequisites)。代码仓库的Dev Container会安装Flutter，`task mobile:android-install`会向其中添加Android SDK和JDK。

克隆之后，在代码仓库根目录运行一次`task setup`；如果那里只构建应用，则运行`task mobile:deps`。

## 本节内容

前六个页面按照工作的顺序排列。第一次发布需要完成所有这些步骤；之后的版本只需要构建和提交。最后一个页面说明应用在设备上保存的内容，供负责这方面的工作人员参考。

- [应用清单](./1-app-manifest.md)：为应用命名，指定它服务的租户，以及商店识别它所用的标识符。
- [构建和签名](./2-building.md)：根据清单生成已签名的Android App Bundle和iOS归档。
- [推送通知](./3-push-notifications.md)：Firebase项目、Apple的推送密钥，以及租户控制台发送通知所用的凭据。
- [应用链接](./4-app-links.md)：让指向租户网站的链接在应用中打开。
- [应用内购买和登录](./5-purchases-and-sign-in.md)：应用通过商店销售章节、以及让读者通过Apple和Google登录所需的内容。
- [提交到商店](./6-store-submission.md)：商店页面，以及App Review和Google Play审核需要出版社提供的内容。
- [离线阅读](./7-offline-reading.md)：应用为无网络阅读保存的内容、付费章节可以保持可读的时长，以及截屏提示。
