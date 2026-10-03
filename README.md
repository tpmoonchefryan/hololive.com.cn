# hololive.com.cn

HololiveCN MC 服务器官网与管理后台项目。  
当前仓库已从“纯展示站点”演进为“前台内容站点 + 后台 CMS + 服务器运维面板（Velocity/MCSM）”的完整系统。

## 1. 项目概览

- 前端：`Vite + React + Tailwind CSS`
- 数据与认证：`PocketBase`
- 扩展后端服务：
  - `backend/scripts/sync_velocity.js`（Velocity 配置同步守护进程）
  - `backend/scripts/map_proxy.js`（地图同源代理）
  - `backend/scripts/mcsm_proxy.js`（MCSM API 代理）
- 多语言：`zh / en / ja`
- 审计日志：关键后台操作写入 `audit_logs`

## 2. 功能矩阵

### 前台功能

- 首页 CMS：从 `cms_sections` 动态加载多语言分段、背景与按钮
- 文档中心：公告/文档分类列表与文章详情
- 全局横幅公告：支持定时生效、类型（普通/紧急）、多语言
- 服务器信息页：
  - 动态字段（`server_info_details`）
  - 外部地图切换与全屏
  - HTTPS 页面内嵌 HTTP 地图（通过 `/map-proxy/` 规避混合内容）
  - `mcsrvstat.us` 在线状态
  - MCSM 公共资源状态面板（`/mcsm-api/public/status`）

### 后台功能

- 隐藏入口 + 双重鉴权：
  - `/:adminKey/webadmin` 路径校验（`system_settings.admin_entrance_key`）
  - PocketBase 登录态校验
- 内容管理：
  - 文章管理（多语言、封面、置顶、富文本）
  - 公告管理
  - 首页分段管理（含按钮、多语言、一键翻译）
  - 资源库管理（`media`）
  - 服务器地图管理
  - 服务器信息字段管理
- 账号与安全：
  - SSO 白名单（`whitelists`）
  - 本地管理员账号（`users`）
  - 本地登录开关（`system_settings.enable_local_login`）
- 系统设置：
  - 统计脚本（Google/Baidu）
  - 后台入口 Key 管理
- 审计日志：
  - 登录/创建/更新/删除/系统设置等操作追踪
- 运维面板：
  - Velocity 管理（设置、节点、forced hosts、jar 上传、重启触发）
  - MCSM 管理（概览、实例控制、控制台、文件管理、配置）

## 3. 技术栈

- 运行与构建：`Vite 7`, `React 19`, `React Router 7`
- 样式与 UI：`Tailwind CSS 4`, `framer-motion`, `lucide-react`
- 富文本：`Tiptap`
- 国际化：`i18next + react-i18next`
- 数据访问：`PocketBase JS SDK`
- 内容渲染：`html-react-parser`, `react-markdown`（兼容场景）
- 代码质量：`ESLint 10`

## 4. 架构简图

```text
Browser
  ├─ Frontend (React/Vite)
  │   ├─ /api/*, /_/  -> PocketBase (Nginx 反代)
  │   ├─ /map-proxy/* -> map-proxy 服务
  │   └─ /mcsm-api/*  -> mcsm-proxy 服务
  │
  └─ Admin UI
      ├─ 内容管理 -> PocketBase Collections
      ├─ Velocity 面板 -> velocity_* Collections
      └─ MCSM 面板 -> mcsm_config + mcsm-proxy

PocketBase
  ├─ 认证、集合数据、文件存储
  └─ Realtime 订阅 -> velocity-sync

velocity-sync
  ├─ 读取 velocity_* 集合
  ├─ 生成 /opt/velocity/velocity.toml
  ├─ 同步 velocity.jar / forwarding.secret
  └─ 重启并监控 velocity systemd 服务
```

## 5. 目录结构

```text
.
├─ src/                       # React 前端
│  ├─ pages/                  # 前台与后台页面
│  ├─ components/             # 组件（含 admin/、layout/、server/）
│  ├─ hooks/                  # 业务 Hook（CMS / Velocity / MCSM）
│  ├─ lib/                    # PocketBase、日志、翻译工具
│  └─ i18n.js                 # 多语言资源
├─ backend/
│  ├─ pb_migrations/          # PocketBase 迁移（当前真相源）
│  ├─ scripts/                # map/mcsm/velocity 服务脚本与 systemd 模板
│  └─ pocketbase.exe          # Windows PocketBase 可执行文件
├─ scripts/
│  ├─ check_bundle_budget.mjs # 构建产物体积预算检查
│  └─ setup_velocity.sh       # Ubuntu 初始 Velocity 安装脚本
├─ .github/workflows/deploy.yml
├─ deploy.sh                  # 既有主机有限维护入口
├─ DEPLOY.md                  # 完整产物、有限维护和恢复契约
└─ RUNNER_SETUP.md            # 自托管 Runner 说明
```

## 6. 快速开始（开发环境）

### 6.1 前置要求

- Node.js `20+`（推荐 LTS）
- npm `10+`（或兼容版本）
- PocketBase：
  - Windows：可直接用 `backend/pocketbase.exe`
  - Linux/macOS：需自行下载对应 `pocketbase` 二进制到 `backend/`

### 6.2 安装依赖

```bash
npm install
```

### 6.3 配置环境变量

创建 `.env.local`：

```bash
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

### 6.4 启动 PocketBase

Windows:

```bash
cd backend
./pocketbase.exe serve --http=127.0.0.1:8090
```

Linux/macOS:

```bash
cd backend
./pocketbase serve --http=127.0.0.1:8090
```

### 6.5 启动前端

```bash
npm run dev
```

默认访问：`http://127.0.0.1:5173`

### 6.6 首次后台登录要点

1. 进入 PocketBase 管理面板：`http://127.0.0.1:8090/_/`
2. 确认已存在可登录的 `users` 账号
3. 在 `whitelists` 集合加入允许访问后台的邮箱
4. 在 `system_settings`（ID=`1`）读取 `admin_entrance_key`
5. 访问：`http://127.0.0.1:5173/<admin_entrance_key>/webadmin/login`

注意：仓库当前不提供固定默认后台账号密码。

## 7. 环境变量

### 7.1 前端变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `VITE_POCKETBASE_URL` | 是 | 无 | PocketBase 基础地址 |
| `VITE_MAP_PROXY_PREFIX` | 否 | 自动推断 | 地图代理前缀（如 `/map-proxy/`） |
| `VITE_APP_LOG_LEVEL` | 否 | `warn`(DEV)/`error`(PROD) | 前端日志级别 |
| `VITE_ALLOW_LOCAL_WHITELIST_FALLBACK` | 否 | `false` | DEV 下本地白名单回退开关 |
| `VITE_ADMIN_KEY` | 否 | 空 | 仅 DEV 下 `AdminGuard` 回退值 |

### 7.2 后端服务变量（systemd / shell）

| 变量 | 作用 |
|---|---|
| `PB_URL` | PocketBase 地址（默认 `http://127.0.0.1:8090`） |
| `PB_EMAIL` / `PB_PASS` | `velocity-sync` 登录 PocketBase 必填凭据 |
| `VELOCITY_DIR` | Velocity 安装目录（默认 `/opt/velocity`） |
| `VELOCITY_OWNER` | Velocity 文件属主（默认 `ubuntu:ubuntu`） |
| `MAP_PROXY_PORT` | 地图代理端口（默认 `18090`） |
| `MCSM_PROXY_PORT` | MCSM 代理端口（默认 `18091`） |
| `MCSM_ALLOWED_ORIGIN` | MCSM CORS 允许源 |
| `LOG_LEVEL` / `*_LOG_LEVEL` | 后端脚本日志级别 |

`velocity-sync.service` 额外支持 `/etc/default/velocity-sync` 作为环境文件。

## 8. 数据模型与迁移

- 当前结构以 `backend/pb_migrations/*.js` 为准（自动迁移）
- 核心业务集合：
  - `posts`, `announcements`, `cms_sections`, `media`
  - `server_maps`, `server_info_details`
  - `system_settings`, `whitelists`, `audit_logs`
- 运维相关集合：
  - `velocity_settings`, `velocity_servers`, `velocity_forced_hosts`
  - `mcsm_config`

### 关于 `pb_schema.json`

`pb_schema.json` 目前仅覆盖核心 9 个集合，不包含 Velocity/MCSM 新集合。  
如需完整初始化，请依赖 `backend/pb_migrations` 自动迁移流程。

## 9. 常用命令

```bash
npm run dev           # 启动前端开发服务器
npm run build         # 生产构建
npm run preview       # 预览构建结果
npm run lint          # ESLint（0 warning）
npm run lint:fix      # 自动修复 lint 问题
npm run audit:prod    # 生产依赖安全审计
npm run check:bundle  # 构建体积预算检查
```

## 10. 部署说明

### 10.1 既有主机维护

`deploy.sh` 调用 `scripts/deployment.mjs`，使用独立批准的 root 私有配置与完整 bundle。执行条件、首次 mixed 停服备份、恢复演练、真实目标身份和 Java 保护见 [DEPLOY.md](DEPLOY.md)。现有 `setup_*.sh` 的初装与配置动作另行批准。

### 10.2 CI/CD（GitHub Actions）

工作流 [deploy.yml](.github/workflows/deploy.yml) 使用既有 self-hosted runner，沿用 `main` push / 手动入口。`DEPLOY_CONFIG` 指向主机 root 所有的有限配置，绑定获准提交与真实 run。工作流检查、构建并封装 `dist`、migrations、hooks、scripts 和锁定运行依赖；在原维护顺序中核对主机及历史、停止 sync、写 guard、停止 PB、备份、隔离恢复与迁移验证，再安装和核验目标认证。成功记录须有本次实际证据；生产前提缺失时拒绝。完整配置与服务边界见 [DEPLOY.md](DEPLOY.md)，runner 核对见 [RUNNER_SETUP.md](RUNNER_SETUP.md)。

### 10.3 生产服务与端口

| 服务 | 端口 | 说明 |
|---|---|---|
| `pocketbase` | 8090 | API 与后台管理 |
| `map-proxy` | 18090 | 地图代理 |
| `mcsm-proxy` | 18091 | MCSM 代理 |
| `velocity` | 25577（默认） | Minecraft 代理端口（由配置决定） |
| `velocity-sync` | - | 守护进程，不对外开放端口 |

## 11. 安全与运维提示

- 后台入口 Key 存于数据库，不要写死在代码或公开文档。
- SSO 和本地登录都受白名单/账号策略约束，请最小化授权。
- `map-proxy` 仅允许转发 `server_maps` 中登记的目标源，避免开放代理风险。
- `mcsm-proxy` 公共接口有速率限制，管理接口要求 PocketBase 有效登录态。
- `audit_logs` 已接入关键后台动作记录，建议定期归档与审计。

## 12. 常见问题

### 访问后台返回 404

`/:adminKey/webadmin` 中的 `adminKey` 与 `system_settings.admin_entrance_key` 不一致。

### 地图无法在 HTTPS 页面内嵌

- 地图源是 `http://` 且未配置 `/map-proxy/` 路由
- 请检查 `map-proxy` 服务与 Nginx 配置

### Velocity 状态长期为 pending/unknown

- `velocity-sync` 未运行或缺少 `PB_EMAIL/PB_PASS`
- `velocity` 服务未启动，或 `/opt/velocity` 权限不正确

### MCSM 面板数据为空

- `mcsm_config.enabled` 未开启
- `panel_url` / `api_key` 配置错误
- `/mcsm-api/` 路由或 `mcsm-proxy` 服务未正确部署

## 13. 参考文档

- 部署手册：[DEPLOY.md](DEPLOY.md)
- Runner 配置：`RUNNER_SETUP.md`
- 有限维护入口：[deploy.sh](deploy.sh)
- 后端服务脚本：`backend/scripts/`

## 本地验证与授权迁移

PocketBase 支持基准为 **0.26.5 和 0.34.2**；部署读取实际主机版本，不设下载或升级默认值；升级前须另行批准并在隔离副本执行迁移重放。Windows 或 Linux 使用同版本官方二进制；测试通过 `PB_TEST_BINARY_026` / `PB_TEST_BINARY_034` 指定文件。

管理员授权由超管供应 `users.is_admin=true`，并验证身份后设 `verified=true`。无人根据邮箱白名单自动升级；既有 whitelists 只作为业务资料。服务账号由超管另设 `service_account=true`，使用独立凭据并可通过撤销 `is_admin` 立即停止管理访问。普通 users 创建、修改、删除由超管管理，OAuth 新身份仍由可信供应流程建立，不能自行提升管理员。

`enable_local_login` 仅控制已授权人类管理员的密码认证；关闭时 API 同样拒绝，Microsoft OAuth 与显式供应的服务账号路径保留。设置缺失时密码入口关闭。部署必须一并包含 `backend/pb_hooks`；管理代理每次请求重新检查服务端授权，不缓存权限。

空库在 1765100006 执行前追加 1765100000 兼容迁移，按扁平属性预置两个 select 字段；原历史迁移文件保持原字节；已应用迁移的库通过追加迁移规范字段约束，不删历史、不改已有数据。先备份并验证隔离副本和实际迁移历史，再由另获授权的生产操作应用。回退优先恢复验证过的数据库备份；安全迁移 down 不恢复宽松权限。真实管理员/服务身份保留名单须由维护者核实，本地夹具不代表生产名单。

MCSM 公开状态与 Velocity Sync 的 `PB_EMAIL` / `PB_PASS` 必须属于 `users` 集合中 `is_admin=true` 且 `service_account=true` 的独立服务身份，不再接受超管凭据。两者共用登录/刷新检查；Velocity 每次同步、订阅回调及状态更新都复核权限。关闭人类密码登录不关闭服务身份；撤销任一服务权限后拒绝后续动作。生产切换前须由维护者在既定部署阶段核实已有服务身份与凭据，本地验证不会创建生产账号。
