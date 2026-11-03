---
title: 应用链接
description: 在租户控制台中指定已发布的应用，让指向租户网站的链接在其应用中打开。
published: 2026-11-03
source_updated: 2026-10-17
---

指向租户网站的链接（系列、章节、公告，或网站邮件中的确认链接和密码重置链接），在安装了应用时会在应用中打开，而不是在浏览器中打开。只有在Android和iOS确认网站为该应用作了担保之后，才允许这样做。它们会向网站请求两个文件：

- `https://<tenant.host>/.well-known/assetlinks.json`，用于Android
- `https://<tenant.host>/.well-known/apple-app-site-association`，用于iOS

网站根据租户控制台中**集成** › **应用链接**里保存的内容生成这两个文件。不需要向Web服务器上传任何内容。

这两个文件同样为应用使用网站的通行密钥作担保。读者注册的通行密钥属于租户的主机，只有当某个主机的文件为此指定了某个应用时，Android和iOS才允许该应用使用该主机的通行密钥：即`assetlinks.json`中与用于链接的`delegate_permission/common.handle_all_urls`并列的`delegate_permission/common.get_login_creds`关系，以及`apple-app-site-association`中与`applinks`并列的`webcredentials`条目。网站会为它指定的每个应用写入这两者，因此无需为通行密钥额外填写任何内容。Android应用的通行密钥登录是以其签名证书而不是以网站的身份到达服务器的，服务器只接受指纹保存在此处的证书，因此用未列出的密钥签名的构建无法使用网站的通行密钥。

同一页面也为安装实例的其他部分指定应用。应用内购买的App Store和Google Play部分会在这里指定的应用中销售，通过Apple登录也信任这里指定的应用，因此在应用中试用这两者之前，请先填写此页面。

## 何时填写

Android的指纹不是由您选择的：使用Play应用签名（Play App Signing）时，它属于Google为已安装应用签名所用的密钥，在Play Console中创建应用并上传第一个App Bundle之后，Play Console才会显示它。iOS部分随时都可以填写，Android部分请在Play Console显示该密钥之后再填写。

这些值始终是商店分发的应用的值，即[构建和签名](./2-building.md)中的商店构建。哪怕只与已发布的应用相差一个字符，其链接也会在浏览器中打开，而且没有任何地方会报告这种不一致。

## 填写应用

在租户控制台中打开**集成** › **应用链接**。

### Android

勾选**在租户的Android应用中打开链接**，并填写：

| 字段 | 值的来源 |
| --- | --- |
| **应用ID** | 清单中的`android.applicationId`。Google Play会在应用商店地址的`id=`中显示相同的值 |
| **SHA-256签名证书指纹** | Play Console中应用的**App signing**页面上**app signing key certificate**的SHA-256指纹。不是上传密钥的指纹：上传密钥不会为Play分发的内容签名 |

指纹是用冒号分隔的32对十六进制数字，形如`AA:BB:…`，该字段最多可填写十个，每行一个。当以其他方式签名的构建也需要打开链接时，请再列出一个：例如为测试而安装的发布APK（它用上传密钥签名），或密钥轮换期间的新密钥。上传密钥的指纹是以下命令输出中的`SHA256:`一行：

```bash
keytool -list -v -keystore ~/example-reader/upload.jks -alias upload
```

### iOS

勾选**在租户的iOS应用中打开链接**，并填写：

| 字段 | 值的来源 |
| --- | --- |
| **Apple Team ID** | Apple Developer网站**Membership details**中的10位Team ID：即构建应用时使用的`PUBLIRA_IOS_DEVELOPMENT_TEAM` |
| **Bundle ID** | 清单中的`ios.bundleIdentifier`。App Store Connect会在**App Information**下以Bundle ID显示相同的值 |

选择**保存应用链接**。未勾选的平台会得到`404`响应，这会告诉该平台没有应用；没有应用的租户两者都不勾选。

清单中的`tenant.host`在这里没有对应的字段，因为它已经确定了：Android和iOS会询问链接所指向的主机，而应用只声明该主机。因此，它必须是提供租户网站的主机。

## 检查链接

首先确认网站提供了这两个文件：

```bash
curl -i https://reader.example.com/.well-known/assetlinks.json
curl -i https://reader.example.com/.well-known/apple-app-site-association
```

两者都应以`200`响应，并包含您保存的标识符：`assetlinks.json`为Android应用列出两种关系，`apple-app-site-association`在`applinks`和`webcredentials`下都指定了iOS应用。两种手机都会拒绝经过重定向获取的文件，因此安装实例前面的反向代理必须在租户主机本身上、通过HTTPS响应这些路径。

在Android上，手机会在安装或更新应用时检查网站。安装构建，然后询问手机的判断结果：

```bash
adb shell pm get-app-links com.example.reader
```

检查通过时，租户主机会显示为`verified`。在控制台中更正某个值后，请用`adb shell pm verify-app-links --re-verify com.example.reader`让手机重新检查。

在iOS上，获取该文件的是Apple的服务器而不是手机，手机在安装应用时从Apple的服务器获取它。控制台中的更改通过这种方式可能需要一段时间才能到达手机；之后重新安装应用即可获取更改。

在任意一种手机上，点按邮件或备忘录中指向租户网站某个系列的链接。它会在应用中打开该系列。在浏览器地址栏中输入的链接会留在浏览器中；这是两个平台的正常行为，并不是检查失败。

下一步：[应用内购买和登录](./5-purchases-and-sign-in.md)。
