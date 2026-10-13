# 更新与回退

适用于当前 Azure Linux 主机，由有服务器维护权限的人操作。不会从本地导入数据库，也不会改写邮件或其他环境配置。

## 发布

1. 在本地运行 `npm test` 和 `npm run build`。
2. 打包 `server shared dist/client deploy package.json package-lock.json` 为 `app.tar.gz`，上传到 `/home/azureuser/nnu-upload/`。包里不要放数据库、`.env` 或密钥。
3. 发布工具有变更时，将 `deploy/update-release.sh`、`deploy/check-release.mjs` 和 `deploy/release-assets.mjs` 一并更新到上述上传目录。Shell 文件保持 LF 换行。
4. 执行：

   ```sh
   sudo bash /home/azureuser/nnu-upload/update-release.sh
   ```

脚本先取得部署锁，再解包、安装依赖并核验入口文件。新旧版本互相补齐 `dist/client/assets` 下带内容哈希的公开资源，不覆盖同名不同内容的文件。备份成功后才原子切换 `current`，重启并检查数据库健康、实际返回的首页和 JS/CSS 内容及类型。通过后保存 `previous` 指向刚才的版本。

不再使用原地替换 HTML 的 `update-frontend.sh`；前端改动也按同一条完整发布流程操作，以保留可回退版本。

## 自动回退

切换后重启失败，或页面与资源检查连续失败时，会自动切回原版本、重启，再检查一次。看到 `Rollback verified` 才表示旧版本已恢复且核验通过；`ROLLBACK FAILED` 表示仍需排查，不能把它当作恢复成功。失败的发布仍返回非零退出码。

备份、依赖安装、资源校验等准备步骤失败时，不切换版本，也不重启线上服务。部署锁会拒绝同时运行的第二次发布。

## 手动回退

需要撤销最近一次成功发布时：

```sh
sudo bash /home/azureuser/nnu-upload/update-release.sh --rollback
```

同样会先备份、保留新旧哈希资源，再切换和核验。成功后 `previous` 指向回退前的版本，再执行一次可以切回去。如果目标版本无法启动，脚本会尝试恢复操作前的版本。

**这里只回退代码，不回滚数据库。** 涉及数据库结构的更新须保持旧代码兼容；不兼容的迁移需要单独制定恢复方案，不能用恢复旧备份覆盖更新后产生的评价。此次改动不包含数据库迁移。

## 旧资源与边界

- 保留的是公开、带哈希的 JS/CSS、图片和字体。不会复制源映射、HTML、数据库或配置文件。
- 目前逐次保留，不自动清理；每版主要增加几百 KB 的 JS/CSS。后续清理历史发布目录时，不要顺手删当前版本中保留的资源。
- 这能减少旧标签页因文件消失出现的 404，但旧页面与新 API 的兼容仍需在功能更新时检查。
- 首次启用时已补入此前实际上线的 2026-09-27 版本资源，此后正常发布会继续继承。
- 重启仍有短暂间隔，本流程不是零停机发布。未使用双实例或代理流量切换。

## 隔离演练

在 Linux 上运行：

```sh
node --test tests/release-assets.test.mjs tests/deployment.test.mjs
```

使用临时目录、虚构服务命令与本地 HTTP 服务，不操作生产服务、不下载依赖、不发邮件。覆盖成功发布、双向手动回退、重启失败、健康异常、旧页面、资源丢失、备份失败、文件冲突、并发锁和回退失败。

`NNU_DEPLOY_*` 环境变量只用于隔离演练或明确配置的其他环境；正常生产执行不需要设置。
