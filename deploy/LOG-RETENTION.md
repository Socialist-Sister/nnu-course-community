# 日志留存与验证

2026-09-15 已在生产服务器应用并验证。

## 范围及期限

网站 Nginx 访问/错误日志，以及 rsyslog 的 syslog、kern.log、auth.log（含 SSH、sudo 认证记录）每日检查轮转，压缩归档。使用 rotate -1、maxage 200、minage 1，按年龄清理，不因固定份数耗尽而提前删除。无新增日志时可能延后清理。其他 rsyslog 文件保留原来的策略。数据库备份、验证码及管理员审计规则未改变。

新访问格式仅记录时间、IP、方法、无查询参数的路径、响应状态、大小及耗时。排除 Cookie、Authorization、请求正文、Referer、User-Agent。旧归档与错误/系统日志仍可能有原格式或故障上下文，按私有运维数据保护，不提供给普通网站管理员。已经删除的历史日志无法补回。

## 安装

```sh
sudo python3 deploy/configure-log-retention.py
sudo python3 deploy/configure-log-retention.py --apply
sudo python3 deploy/verify-log-retention.py
```

实际执行路径可使用服务器私有上传目录。先预检，再备份配置，执行 Nginx 和 logrotate 语法检查、重载；失败自动恢复配置。脚本不强制轮转生产日志，也不删除生产归档。配置备份位于 /etc/nnu-course/log-config-backups/，仅 root 可访问。

验证脚本通过无敏感信息的健康请求确认查询参数不写入访问日志，仅在临时合成文件上强制轮转，验证 199 天保留、201 天清理。检查服务、轮转定时器及日志权限。生产验证已通过。

## 日常维护

日志仅允许 root/授权运维用户读取。现有运维监控新增 logrotate 定时器和执行结果检查。现有磁盘 80%/90% 阈值提醒覆盖日志所在根分区。空间不足时应扩容或迁移到受控存储，不要提前删除尚未满留存期的日志。无需将日志上传 GitHub 或下载给开发成员。

上线时根分区可用约 23GB，Nginx 日志约 14MB；这是检查当时的占用，不是未来增长保证。此设置不能单独证明完整法律合规。

## 回退

由负责人核对备份目录，将 nginx.conf、nginx、rsyslog 分别恢复到 /etc/nginx/nginx.conf、/etc/logrotate.d/nginx、/etc/logrotate.d/rsyslog，执行 nginx -t 和 logrotate --debug /etc/logrotate.conf，再重载 Nginx。配置回退不能恢复已删除日志；勿用回退作为提前缩短留存的常规手段。
