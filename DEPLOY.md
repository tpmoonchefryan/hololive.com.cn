# 部署手册 (Deployment Guide)

这份文档详细说明了如何从零开始部署本项目，以及如何配置自动化部署（CI/CD）。

## 1. 初始部署（Initial Deployment）

使用提供的一键部署脚本，在全新的 Ubuntu 24.04 服务器上快速搭建环境。

### 前置条件
- **服务器系统**: Ubuntu 24.04 LTS (推荐)
- **权限**: 拥有 `root` 权限
- **域名**: `hololive.com.cn` 已经解析到服务器 IP

### 部署步骤

1. **连接服务器**
   使用 SSH 连接到你的服务器：
   ```bash
   ssh root@your_server_ip
   ```

2. **获取项目代码**
   你可以通过 Git 克隆或直接通过 SFTP 上传项目代码到服务器。
   > 推荐上传到 `/root/hololive.com.cn` 或 `/var/www/hololive.com.cn`，脚本会自动处理。

3. **运行部署脚本**
   进入项目目录并执行脚本：
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

4. **等待部署完成**
   脚本会自动执行以下操作：
   - 更新系统并安装 Nginx, Node.js 等依赖
   - 安装 PocketBase 并配置为系统服务
   - 自动创建 PocketBase 超级管理员（Superuser）
   - 构建前端代码
   - 配置 Nginx 反向代理
   - 使用 Certbot 自动申请 SSL 证书

5. **保存凭据**
   脚本运行结束后，屏幕上会显示以下重要信息，**请务必保存**：
   - **PocketBase Superuser**: `ryan.lan_home@outlook.com`
   - **Superuser Password**: (脚本随机生成的强密码)
   - **Web Admin URL**: `https://<your-domain>/<your-admin-key>/webadmin`
   - **重要**: 首次进入后台后请立即设置高强度 `admin_entrance_key`，不要使用默认示例值

---

## 2. 自动化部署 (CI/CD)

本项目预置了 GitHub Actions Workflow，当你推送代码到 `main` 分支时，会自动构建并部署到服务器。

### GitHub Secrets 配置

在 GitHub 项目仓库的 **Settings** -> **Secrets and variables** -> **Actions** 中添加以下 Secrets：

| Secret Name | 说明 | 示例值 |
| :--- | :--- | :--- |
| `HOST` | 服务器 IP 地址 | `123.45.67.89` |
| `USERNAME` | SSH 用户名 | `root` |
| `SSH_KEY` | SSH 私钥内容 (PEM 格式) | **直接复制 `deploy.sh` 脚本运行结束时打印的私钥内容** |

### 部署流程

1. **修改代码**: 在本地进行开发和修改。
2. **推送代码**: 将代码推送到 GitHub 的 `main` 分支。
3. **自动触发**: GitHub Actions 会自动开始构建。
   - 自动安装依赖并执行 `npm run build`
   - 通过 `rsync` 将最新的 `dist/` 目录同步到服务器 `/var/www/hololive.com.cn/dist/`
   - 通过 `rsync` 将最新的迁移脚本同步到服务器 `/var/www/hololive.com.cn/backend/pb_migrations/`
   - 通过 `rsync` 将最新的后端脚本同步到服务器 `/var/www/hololive.com.cn/backend/scripts/`
   - 自动执行 `backend/scripts/setup_map_proxy.sh`，确保 `/map-proxy/` 路由和 `map-proxy` 服务存在
   - 远程重启 PocketBase、Velocity Sync、Map Proxy 服务。

---

## 3. 地图代理说明（HTTP 地图 + 非标端口）

为兼容 HTTPS 页面内嵌 HTTP 地图（如 `http://127.0.0.1:8123`），项目增加了同源代理：

- 前端入口：`/map-proxy/{protocol}/{host:port}/{path}`
- 后端服务：`map-proxy`（`backend/scripts/map_proxy.js`）
- Nginx 路由：`location /map-proxy/ { proxy_pass http://127.0.0.1:18090/; }`

安全策略：

- 代理仅允许转发到 `server_maps` 集合里已配置的地图源站（按 origin 校验）。
- 不允许任意目标转发，避免开放代理风险。

---

## 4. 管理员白名单说明

系统已预置以下管理员邮箱到白名单（`whitelists` 集合）：

1. **`ryan.lan_home@outlook.com`** (您的 SSO 账号)
2. **`admin@local.dev`** (开发环境预留邮箱，仅在显式开启本地回退时使用)
3. **`hardy1035626987@hotmail.com`** (您要求新增的账号)

部署后，这三个账号均可作为管理员访问后台。

## 本地验证与授权迁移

PocketBase 支持基准为 **0.26.5 和 0.34.2**；部署默认 0.26.5，升级前须在隔离副本执行迁移重放。Windows 或 Linux 使用同版本官方二进制；测试通过 `PB_TEST_BINARY_026` / `PB_TEST_BINARY_034` 指定文件。

管理员授权由超管供应 `users.is_admin=true`，并验证身份后设 `verified=true`。无人根据邮箱白名单自动升级；既有 whitelists 只作为业务资料。服务账号由超管另设 `service_account=true`，使用独立凭据并可通过撤销 `is_admin` 立即停止管理访问。普通 users 创建、修改、删除由超管管理，OAuth 新身份仍由可信供应流程建立，不能自行提升管理员。

`enable_local_login` 仅控制已授权人类管理员的密码认证；关闭时 API 同样拒绝，Microsoft OAuth 与显式供应的服务账号路径保留。设置缺失时密码入口关闭。部署必须一并包含 `backend/pb_hooks`；管理代理每次请求重新检查服务端授权，不缓存权限。

空库在 1765100006 执行前追加 1765100000 兼容迁移，按扁平属性预置两个 select 字段；原历史迁移文件保持原字节；已应用迁移的库通过追加迁移规范字段约束，不删历史、不改已有数据。先备份并验证隔离副本和实际迁移历史，再由另获授权的生产操作应用。回退优先恢复验证过的数据库备份；安全迁移 down 不恢复宽松权限。真实管理员/服务身份保留名单须由维护者核实，本地夹具不代表生产名单。

## 地图隔离

两个地图 iframe 均使用允许脚本、表单、指针锁及下载的 sandbox，刻意不启用 allow-same-origin、顶部导航或弹窗权限。代理 HTML 响应额外发送 CSP sandbox，使直接打开同源代理 URL 也不能接触站点存储。地图用匿名 CORS 加载代理资源；父页面 DOM、localStorage 和管理员 token 均处于隔离边界外。依赖持久存储或凭据的地图插件须在隔离来源重新评估，不能通过取消 sandbox 恢复。

允许来源仍取自 server_maps，跨未授权来源的重定向拒绝。代理不转发站点 Cookie/Authorization；解压后的响应移除 Content-Encoding、原始长度与摘要，HTML 重写重新计算 UTF-8 长度。此方案不依赖新增 DNS 或线上来源；本地验证不代表真实地图供应者/生产浏览器验收。

MCSM 公开状态与 Velocity Sync 的 `PB_EMAIL` / `PB_PASS` 必须属于 `users` 集合中 `is_admin=true` 且 `service_account=true` 的独立服务身份，不再接受超管凭据。两者共用登录/刷新检查；Velocity 每次同步、订阅回调及状态更新都复核权限。关闭人类密码登录不关闭服务身份；撤销任一服务权限后拒绝后续动作。生产切换前须由维护者在既定部署阶段核实已有服务身份与凭据，本地验证不会创建生产账号。
