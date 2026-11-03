---
title: 推送通知
description: 设置租户应用接收推送通知所用的Firebase项目，并为租户控制台提供发送通知所需的凭据。
published: 2026-11-03
updated: 2026-11-03
source_updated: 2026-11-02
---

当读者关注的系列发布了新章节，或者读者关注的作者有新章节发布时，应用会在读者的手机上通知他们，点按通知即可打开该章节。为应用开启公告的读者，在出版社发送公告时也会收到通知，点按即可打开该公告。安装实例把通知发送给Firebase Cloud Messaging，由它直接送达Android手机，并通过Apple的推送服务送达iPhone。要让这一切正常工作，以下三者必须指向同一个Firebase项目：

1. **应用**，它使用该项目的值构建，并把每部手机注册到该项目。
2. **Apple**，该项目使用Apple的推送密钥转发iPhone通知。
3. **租户控制台**，它保存该项目的服务账户密钥，`publira worker`用它来发送通知。

每个租户应用使用一个Firebase项目。项目属于构建应用的人，因此出版社可以完全拥有自己的项目。

## 创建Firebase项目

在[Firebase控制台](https://console.firebase.google.com/)中，为租户的应用添加一个项目。不需要Google Analytics，可以将其关闭。

然后从项目的**Project settings** › **General**向项目添加两个应用：

- **一个Android应用**，以清单中的`android.applicationId`作为其软件包名称。下载它提供的`google-services.json`。
- **一个Apple应用**，以清单中的`ios.bundleIdentifier`作为其Bundle ID。下载它提供的`GoogleService-Info.plist`。

接下来，Firebase控制台会要求您把每个文件添加到应用的源代码中，并修改其构建文件。请跳过这些步骤：Publira应用改为从构建命令获取相同的值，因此代码仓库中不会包含任何一个租户的项目。

## 向构建提供项目的值

从这两个文件中复制七个值，写入构建读取的文件，即[构建和签名](./2-building.md#推送通知)中的`~/example-reader/firebase.json`：

```json
{
  "PUBLIRA_FIREBASE_PROJECT_ID": "example-reader",
  "PUBLIRA_FIREBASE_MESSAGING_SENDER_ID": "123456789012",
  "PUBLIRA_FIREBASE_ANDROID_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_ANDROID_APP_ID": "1:123456789012:android:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_IOS_APP_ID": "1:123456789012:ios:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_BUNDLE_ID": "com.example.reader"
}
```

| 值 | 在`google-services.json`中 | 在`GoogleService-Info.plist`中 |
| --- | --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | `project_info.project_id` | `PROJECT_ID` |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | `project_info.project_number` | `GCM_SENDER_ID` |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | Android应用的`api_key`下的`current_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | Android应用的`client_info`下的`mobilesdk_app_id` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

这些值不是密钥：应用的每一份副本都带有它们。缺少项目ID或发送者ID的构建完全没有推送通知，缺少某个平台的一对值的构建在该平台上没有推送通知。

## 向Firebase提供Apple的推送密钥

在持有Apple推送服务的密钥之前，Firebase无法把通知送达iPhone。一个密钥可用于Apple Developer团队的所有应用，因此已经有密钥的团队可以重复使用它。

1. 在Apple Developer网站的**Certificates, Identifiers & Profiles** › **Keys**中创建一个密钥，并为它启用**Apple Push Notifications service (APNs)**。
2. 下载`.p8`文件。Apple只提供一次；请把它保存在您的密钥存储中。记下该密钥的Key ID。
3. 在Firebase控制台中打开**Project settings** › **Cloud Messaging**，在Apple应用的配置下把`.p8`文件作为APNs身份验证密钥上传，并填写其Key ID和团队的Team ID。

应用本身已经在开发环境和生产环境中都向iOS请求了推送通知，因此不需要在Xcode中开启任何内容。

## 向租户控制台提供发送凭据

`publira worker`以Firebase项目的服务账户身份发送每条通知，因此租户控制台需要该账户的密钥。

1. 在Firebase控制台中打开**Project settings** › **Service accounts**，然后选择**Generate new private key**。会下载一个JSON文件。
2. 在租户控制台中打开**集成** › **移动推送**。
3. 填写**Firebase项目ID**（即构建应用时使用的同一个`PUBLIRA_FIREBASE_PROJECT_ID`），并选择下载的文件作为**服务账户密钥文件**。
4. 选择**保存凭据**。

如果密钥来自与所填项目不同的项目，控制台会拒绝它，因为应用永远收不到用它发送的通知。该密钥是只写的：页面会显示它所属的服务账户和保存时间，但从不显示密钥本身，保存新文件会替换它。保存之后，请删除下载的文件。

如果控制台回答API服务器没有加密密钥，说明安装实例启动时没有设置`PUBLIRA_SECRET_ENCRYPTION_KEYS`。运营人员按照[安装](../2-deployments/2-installing.md#生成密钥)的说明设置它，`publira server`使用它重新启动后即可保存密钥。

在保存密钥之前，应用不会收到任何推送通知。无论如何，应用内的通知收件箱都会被填充，对于读者偏好设置中保持开启电子邮件的每种通知，读者仍会收到电子邮件。

## 确认通知能够送达

请在实体手机上试用：Firebase不会向iOS模拟器发送通知。安装发布构建（iPhone上通过TestFlight，Android上安装发布APK），然后：

1. 以读者身份登录应用，打开**账户**，开启**在此设备上接收推送通知**，并在手机询问时允许通知。它上方**通知设置**中的**应用**开关用于选择哪些类型的通知会送达读者的手机：保持它们开启，并开启**公告**下默认关闭的那一个。
2. 在应用中关注一个系列。
3. 从租户控制台发布该系列的一个新章节，其**显示位置**要包含应用。
4. 从租户控制台的[**公告**](../4-console/3-setup/4-announcements.md)发送一条公告。

`publira worker`发送后，每条通知都会送达。点按章节的通知会打开该章节；以公告标题为标题的公告通知会打开该公告。再次关闭**公告**下的**应用**开关，然后发送另一条公告：不会收到它的通知。应用只在读者开启该开关时才向手机请求权限，从不在启动时请求，因此没有开启它的读者不会收到任何通知。

下一步：[应用链接](./4-app-links.md)。
