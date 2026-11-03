---
title: 构建和签名
description: 根据租户应用的清单，生成已签名的Android App Bundle和iOS归档。
published: 2026-11-03
source_updated: 2026-10-25
---

租户应用的一个版本用一条命令`task mobile:build`构建，Android和iOS各运行一次。该命令读取[应用清单](./1-app-manifest.md)，在开始之前检查所有输入，并从未经修改的检出构建应用的商店版本。本页面先介绍它从环境中读取的输入，再介绍两种构建。

该命令接受的所有参数都列在[移动应用参考](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app)中。

## 每次构建都需要的内容

### 应用连接的地址

把租户网站的源（origin）导出为`PUBLIRA_BASE_URL`。应用会在`/rpc`下向它请求API，在`/images`下请求图片，安装实例的反向代理已经对这两者进行了路由：

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

它必须是`https://`，并且只能是源本身，不含路径。对于其他任何值，构建都会拒绝，而不是发布一个只会在读者手机上出错的应用。它通常就是清单中的`tenant.host`，但并不由清单决定：安装实例可以在另一个主机名上提供API，具体见[分开提供图片和公开API](../2-deployments/7-scaling-out.md#分开提供图片和公开api)。这样的主机不提供图片，因此在针对它构建之前，请先为租户设置[图片主机](../3-operations/2-tenants.md#图片主机)：这样应用会从图片主机、按API给出的地址加载所有图片。

### 推送通知

应用接收推送通知所用的Firebase项目会被构建进应用。请在第一次发布之前按照[推送通知](./3-push-notifications.md)的说明进行设置，并把它的值保存在单独的文件中，例如`~/example-reader/firebase.json`。没有提供Firebase值的构建仍然可以运行，但没有推送通知，应用的**账户**页面中也没有推送通知的开关。

### 版本

每次上传到商店都需要一个比商店上次接收的更高的构建号，读者会看到版本名称。请为每次发布构建同时提供这两者：

```bash
--build-name 1.2.0 --build-number 7
```

如果不提供，构建就是`1.0.0`、构建号`1`，从第二次上传开始商店就会拒绝它。

## Android

### 创建上传密钥

Google Play要求每次上传都用同一个密钥（上传密钥）签名。请创建一次，在用于构建的机器上或在您的密钥存储中创建：

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool`随每个JDK提供，它会要求输入密钥库的密码和密钥的密码。请把该文件和两个密码保存在代码仓库之外并进行备份：Play Console可以替换丢失的上传密钥，但只能通过需要Google批准的申请进行，在批准之前无法上传。

Google Play上的新应用使用Play应用签名（Play App Signing）：Google保管已安装应用的签名密钥，上传密钥只用于证明上传来自您。这一区别在[应用链接](./4-app-links.md)页面中还会再次用到。

### 构建App Bundle

在环境中指定密钥库及其密码，然后构建：

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

请在代码仓库根目录下运行。清单或密钥库的相对路径会从您启动命令的目录读取；Firebase文件则从`mobile/`读取，所以示例中给出了它的完整路径。

四个签名变量中缺少任何一个时，构建都会在编译之前停止，而不是用Google Play会拒绝的密钥签名。要上传的App Bundle是`mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`。

如果想在上传之前先在手机上试用该版本，请在相同的变量下构建`apk`而不是`appbundle`，然后安装`mobile/build/app/outputs/flutter-apk/app-production-release.apk`。这样的构建用上传密钥签名，因此除非上传密钥的指纹也列在[应用链接](./4-app-links.md)中，否则指向网站的链接不会打开它。

## iOS

### 准备Mac

iOS构建在装有Xcode的Mac上运行。在**Xcode** › **Settings** › **Accounts**中，让Xcode登录属于出版社Apple Developer团队的Apple账户。构建使用自动签名：Xcode会为Bundle ID注册应用使用的功能（推送通知、关联域和Sign in with Apple），并自行创建证书和描述文件，因此不需要从Apple Developer网站手动下载任何内容。

在Apple Developer网站的**Membership details**中找到团队的Team ID（10位字母和数字），并在环境中指定它：

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

之后还要在[应用链接](./4-app-links.md)中填写同一个Team ID。

### 构建归档

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

归档是`mobile/build/ios/archive/Runner.xcarchive`，要上传的文件是`mobile/build/ios/ipa/`中的`.ipa`。用Apple的Transporter应用上传`.ipa`，或者在Xcode的**Organizer**中打开归档并选择**Distribute App**。App Store Connect处理完成后，它可以进入TestFlight在手机上测试，然后提交审核。

未设置`PUBLIRA_IOS_DEVELOPMENT_TEAM`时，面向设备的构建会在第一步停止，而不是用Xcode最先找到的团队签名。

## 构建留下的内容

构建只会把租户的身份写入Git忽略的文件，如果在代码仓库跟踪的任何文件中留下更改，构建就会失败。因此，同一份检出无需先清理，就可以构建下一个租户的应用或下一个版本。

下一步：[推送通知](./3-push-notifications.md)。
