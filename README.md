# 南师选课簿

南京师范大学学生自发维护的课程信息与评价网站，非学校官方网站。

## 功能

课程与教师搜索、分类筛选、课程评价、校园邮箱注册与找回密码、个人昵称与头像、跨设备收藏、举报和管理后台。

技术栈：React、Vite、Node.js 24+、SQLite。生产环境为 Linux 上的 Node 服务与 Nginx。

## 本地运行

需要 Node.js 24 或更高版本。

```sh
npm ci
```

复制 `.env.example` 为 `.env`，按需填写自己的测试发信配置。不要使用或索要生产密钥。

本仓库不包含用户数据库、备份、登录凭据和原始抓取资料。完整课程导入和依赖课程目录的测试需要由维护者单独提供经检查的课程数据，放在仓库同级的 `course-data` 目录：

- `2026-autumn/courses.json`
- `2026-autumn/offerings.json`
- `2026-autumn/validation-report.json`
- `2026-autumn-deduplicated/offerings.json`

取得数据后运行：

```sh
npm run dev
```

构建不需要生产数据库：

```sh
npm run build
```

本地运行构建结果：

```sh
npm run db:import
npm start
```

服务默认监听 `127.0.0.1:4180`。新数据库为空，不含线上账号或评价；不得复制生产数据库作为开发测试库。

## 验证

```sh
npm test
```

部分测试依赖上述课程数据。首次管理员初始化码在本地数据库目录生成，仅用于本地账号；不要提交或分享。

## 协作与发布

请先阅读 [协作约定](CONTRIBUTING.md)。仓库暂为私有协作仓库，尚未授予开源许可证。网站运行数据与代码分开管理；提交代码不会自动部署线上网站。
