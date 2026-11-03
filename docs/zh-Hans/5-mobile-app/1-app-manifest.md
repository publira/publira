---
title: 应用清单
description: 编写为租户应用命名并指定商店识别它所用标识符的文件，并在构建前检查它。
published: 2026-11-03
source_updated: 2026-10-21
---

应用清单是一个简短的YAML文件，说明一次构建属于谁的应用：主屏幕上的名称、它服务的唯一租户，以及发布它所用的标识符。租户应用的每次构建都会读取它，因此请把它和租户的其他构建输入放在一起，放在代码仓库之外，并纳入您自己的版本控制。

## 编写清单

把[`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml)复制到您自己的目录中，例如`~/example-reader/app.yaml`，并把每个值都替换为该租户的值：

```yaml
# yaml-language-server: $schema=https://www.publira.dev/schemas/app-manifest/v1.json
schemaVersion: 1

app:
  name: Example Reader

tenant:
  host: reader.example.com

android:
  applicationId: com.example.reader

ios:
  bundleIdentifier: com.example.reader
  googleSignInClientId: 123456789012-abc123.apps.googleusercontent.com
```

| 字段 | 填写内容 |
| --- | --- |
| `schemaVersion` | `1`。它表示文件的格式，而不是应用的版本 |
| `app.name` | 主屏幕上图标下方的名称。请保持足够简短，以免在那里被截断；商店页面有自己的标题 |
| `tenant.host` | 租户公开网站的主机名，不含`https://`或路径。应用只服务于这个租户，Android和iOS会根据这个主机检查其链接 |
| `android.applicationId` | Google Play识别应用所用的应用ID，例如`com.example.reader`：由点分隔的两个或更多部分，每部分以字母开头，只包含字母、数字和下划线 |
| `ios.bundleIdentifier` | App Store识别应用所用的Bundle ID：由点分隔的两个或更多部分，由字母、数字和连字符组成 |
| `ios.googleSignInClientId` | 可选。租户Google登录的iOS客户端，具体见[应用内购买和登录](./5-purchases-and-sign-in.md#通过apple和google登录)。iOS应用不提供Google登录时，请省略这一行 |

其他字段都是必填的，格式中未定义的字段会被视为错误，而不是被忽略。

### 标识符只选择一次

应用ID和Bundle ID是商店识别应用的方式。一旦商店有了使用某个标识符的构建，它就不能再更改：不同的标识符就是不同的应用，没有评价、没有安装量，也无法把读者迁移过去。请在第一次上传之前选定它们，并在之后的每个版本中保持不变。

常见的形式是把出版社拥有的域名倒过来写，再加上应用的名称：`example.com`对应`com.example.reader`。两者可以相同，通常也是相同的。它们也可以不同，这样已经在某个商店中有应用的出版社可以在那里保留原有的标识符。

应用的开发构建会在两者后面加上`.dev`，以便它可以和已发布的应用并存于测试设备上。该构建永远不会上传，其标识符也不会填写到任何地方。

## 检查清单

在代码仓库根目录下，构建之前先检查文件：

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

它输出的这一行，就是根据此清单构建的应用所具有的身份，也是您之后要复制到租户控制台和商店控制台中的内容。清单有问题时，它会一次性列出所有问题，并以非零状态退出，构建也会以同样的方式拒绝它：

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

支持JSON Schema的编辑器会在您输入时检查文件：第一行的注释把编辑器指向该[格式](https://www.publira.dev/schemas/app-manifest/v1.json)。

下一步：[构建和签名](./2-building.md)。
