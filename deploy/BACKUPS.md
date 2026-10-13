# 备份与换机恢复

服务器每日备份数据库；负责人电脑的隐藏任务每小时尝试下载，当天成功后跳过。电脑需开机、登录并连接维护网络。备份放在项目的 `local-backups/`，不进入 GitHub。

## 两种本地副本

- `.sqlite.dpapi`：由原 Windows 账号解密，沿用原来的方式。
- `.sqlite.nnu-backup`：可在 Windows、Linux、macOS 上用恢复钥匙解密，不依赖原 Windows 账号。启用后从新备份开始生成，旧 DPAPI 文件不会自动转换。

各保留最近 30 份。下载先核对服务器 SHA-256，再检查 SQLite 完整性、外键和 DPAPI 解密结果。可移植副本使用随机 AES-256-GCM 数据密钥及 RSA-3072/OAEP-SHA256 密钥封装，头部和内容一同认证；本机还有恢复私钥时，也逐份解密核对。移走私钥后照常生成加密副本，但状态中的 `portableRoundTrip` 为 false，不能将其当作已逐份演练恢复。

## 保存恢复工具

安装本地任务时会生成 `local-backups/recovery-kit/`。已安装任务的电脑可运行一次：

```sh
node deploy/portable-backup.mjs init local-backups/recovery-kit
```

首次安装任务需通过 `deploy/install-local-backup.ps1 -KeyPath "私钥路径"` 显式指定 SSH 私钥，可用 `-Target`、`-HostKeyAlias`、`-KnownHostsPath` 配置维护地址和已核验主机指纹。已有任务不必重新安装。

已存在的目录不会被覆盖。目录中包含独立恢复脚本、说明、公钥和 `recovery-private.pem` 私钥。将整个目录另存到加密 U 盘或密码管理器，与备份分开保管；确认副本可用后，可以移走本机私钥，但保留 `public.pem`。不要重新生成公钥替换旧钥匙，旧备份仍需要旧私钥。

**仅在同一块硬盘上生成恢复工具，不等于完成异地保存。** 拿到恢复私钥和备份的人可以读取完整数据库。勿上传共享仓库、群聊或普通公开网盘。备份目录须保持私有访问权限。

## 换电脑恢复

准备 Node.js 24、一份 `.nnu-backup` 文件和对应恢复工具，在私有目录运行：

```sh
node portable-backup.mjs decrypt "catalog-example.sqlite.nnu-backup" recovery-private.pem "restored.sqlite"
```

输出文件必须尚不存在。密文损坏、钥匙不匹配或认证失败时不会输出解密内容，也不会覆盖原文件。此工具只解密，**不会写入线上数据库**。此后保持恢复文件私有，用当前项目做隔离验证：

```sh
node deploy/restore-drill.mjs --source "/private/path/restored.sqlite"
```

演练使用临时副本和模拟邮件，不给真实用户发信，也不修改输入备份。完成后删除不再需要的明文文件。正式恢复应另行确定停写时间、备份版本以及备份之后的新增评价、注销和管理操作如何处理；不能直接用旧快照覆盖线上库。

跨平台数据库恢复不包含整台虚拟机重建。重新建机还需代码、域名/证书、服务配置和邮件凭据；这些配置及凭据应由负责人另行安全保存。
