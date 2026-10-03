# 现有主机维护与部署

现有 `main` push 和 `workflow_dispatch` 入口使用 self-hosted runner。一次维护必须绑定已批准的完整提交；本地测试、旧成功 run 和 HTTP 200 均不能证明本次上线。`deploy.sh` 是有限维护入口，调用 `scripts/deployment.mjs`；先核实服务库存、版本、路径与恢复条件，再执行获准动作。

## 产物与目标契约

每个 bundle 包含 `dist`、`backend/pb_migrations`、`backend/pb_hooks`、`backend/scripts`、根 `package.json` / `package-lock.json` 和由该 lock 通过 `npm ci --omit=dev --ignore-scripts` 安装的 `node_modules`。`release.json` 绑定 SHA、完整路径、文件摘要及内部相对符号链接，校验缺 hooks、运行依赖、版本漂移、篡改或外部链接。构建和部署安装均验证清单；删除只限上述应用产物。已有生产迁移必须全部存在于获准 bundle 且字节完全相同；未知、缺失或修改的历史迁移在任何服务停止和写入前拒绝，不删除它们。`backend/pb_data`（包括媒体）、`.env`、PB 二进制和其他目录保留。运行依赖随应用备份、更新和恢复，不能靠 runner 工作目录碰巧提供。

生产具体值来自主机上独立批准、root 所有且其他用户不可写的 JSON 配置文件。GitHub 仓库的 `DEPLOY_CONFIG` variable 只指向该文件；配置缺失、候选未批准、库存未验证时 job 失败。不要把个人 SSH 私钥复制到 GitHub。已有 runner 承担执行；仓库代码不会安装/注册 runner、改 GitHub secret 或赋予权限。

配置必需字段：

| 字段 | 来源与约束 |
| --- | --- |
| `approvedRevision`, `previousRevision` | 本次明确批准 SHA、实际部署前版本；不是旧 run 猜值 |
| `repository` | 实测当前 Actions 仓库全名，与真实 run 环境匹配 |
| `machineIdSha256`, `runnerUser` | 实测主机身份摘要、runner 服务用户 |
| `webRoot`, `backupRoot`, `stateRoot`, `velocityRoot` | 已核定的绝对真实目录；互不嵌套，无符号链接 |
| `pocketbaseVersion` | 主机二进制实测，仅支持已隔离验证的 0.26.5 / 0.34.2；维护不下载或升级 PB |
| `websiteServices`, `serviceBindings` | 实测网站服务列表和 `systemctl show` 的 ExecStart/WorkingDirectory/User/Requires/BindsTo/PartOf 原样有限绑定；工作目录必须对应同一 webRoot；允许 pocketbase、velocity-sync 及现有四个网站代理 |
| `nginxSiteFile`, `configurationFiles` | 已核定 sites-available 文件、上述网站 unit/env 文件和根/backend `.env` 的明确名单；必须包含全部网站 unit 和该 nginx 文件，另列实际 env；只备份，维护不覆写配置 |
| `velocityServiceBinding` | Java 服务 Requires/BindsTo/PartOf 实测反向依赖；漂移拒绝 |
| `protectedVelocityFiles`, `velocityPorts` | 实测 Java 配置、JAR、secret、marker 及监听端口 |
| `pocketbaseHealthUrl` | 已核定 loopback 健康端点 |
| `baselineReviewed`, `serviceIdentityReviewed`, `restoreRehearsalRequired` | 前基线/实际服务身份和一致恢复条件已明确核实；字段不是机器自动制造的审批 |

`concurrency` 串行且不取消正在维护的任务；主机排他锁涵盖检查、备份、迁移和切换。开始及切换前都读取当前远端 main SHA；持久状态拒绝旧/重复 run 和未解决的失败。锁冲突不自动删除他人锁。网络审计失败停止上线，不能标成已通过。

## 有限更新顺序

1. 核对完整候选、root 配置、物理主机、用户、目录、服务绑定、PB 版本和实际 main，取得 Java 启动标记/PID/重启计数、文件摘要与监听基线。
2. 停止旧 `velocity-sync`，等待其退出；写 `backend/.velocity-maintenance` 持久保护标记，再停止 PocketBase。停止 sync 本身不会停止 Java Velocity；维护路径从不调用 Java 服务。
3. 在网站写入前备份旧应用及锁定依赖、完整 `pb_data`（DB/WAL/媒体）和明确配置文件。PB 已停止，使这些数据一致。备份私有目录权限 0700，摘要、集合契约、迁移历史、表字段/数量、日志留在私有目录，不上传 GitHub 或公开仓库。
4. 复制备份到隔离目录，逐文件匹配摘要，数据库只读 `quick_check`，然后用同版本 PB 和本次 hooks/migrations 对隔离副本重放迁移。保留迁移前契约和隔离结果。任何失败停止生产写入。
5. 仅替换清单中的应用产物，再核对摘要。对停止中的生产 PB 运行本次迁移；检查退出码及错误文本。启动 PB，确认真实 JSON 健康状态，再按库存启动受保护 sync、重启已存在的网站代理。Nginx、Java、unit/env 配置、操作系统和账号均不被改写。
6. 比较 Java PID、启动单调时间、重启计数和文件摘要完全一致，并核对代理监听；记录此次 run/SHA、备份位置、有限动作和持久部署状态。运行及外部玩家代理观察仍须另存实际证据；一次 is-active 不证明连续性。

保护标记不会自动删除。新版 daemon 在首次同步、settings/server/forced-host 实时事件及迁移触发事件执行前检查标记；存在时不读取/生成配置、不下载 JAR、不写配置/secret、也不 restart Java。网站维护后 sync 配置应用暂停，这是明确的运维状态。恢复同步需要另外确认真实数据/磁盘差异、服务身份及保护 Java 的具体方案与授权；不要在本轮中顺手删除标记。

任何步骤失败都不宣称成功。应用可能已替换、PB/sync 可能仍停着；失败记录保留，后续 run 拒绝覆盖。自动恢复数据可能毁掉新数据，维护不会未经明确恢复授权擅自回退。

## 一致恢复

本地/主机隔离恢复入口：

```bash
node scripts/deployment.mjs restore-isolated APPROVED_PRIVATE_BACKUP NEW_ISOLATED_DIRECTORY
```

该入口只接受新目录，校验备份白名单和全部文件摘要和原权限，恢复同一备份中的旧应用、锁定依赖与完整 DB/WAL/媒体；缺项以 backup manifest 原样记录。原备份保留。配置摘要和数据库完整性由部署的隔离 rehearsal 另行核对。

真实恢复须先批准具体备份、目标、候选和服务动作。先停止 sync/PB，保留失败版本与其数据，再恢复同一快照的应用和完整数据及需要恢复的明确配置。不得单独倒退应用或数据库、删除迁移历史或放宽安全授权；若备份早于安全修复，先在隔离恢复副本落实既定授权迁移并核实真实人类/服务身份，再裁定可恢复的安全版本。旧 daemon 不理解保护标记，恢复旧代码时 `velocity-sync` 必须保持停止；不得启动旧 daemon 后碰运气观察 Java。恢复前、中、后分别保存 Java 启动/文件/监听/代理证据。缺少安全前提时该恢复动作未就绪，不启动它。

## 上线后核验

STORY010 必须读取本次真实 Actions run URL/id、触发方式、SHA、目标完整清单和迁移前私有基线。核对本次部署版本、实际集合字段/规则、迁移历史和前后数据/媒体；检查 PB 和网站代理日志、公开与后台关键业务、授权正反例以及 Java 代理连续性。缺少实际 run 或前基线时保持未就绪；命令 0、HTTP 200 和本地夹具不替代这些结果。

管理员授权由可信供应者设置 `users.is_admin=true` 并核实身份。旧 `whitelists` 是业务资料，不能按历史邮箱表自动授予管理员。服务凭据属于独立 `users` 身份，要求 `is_admin=true`、`service_account=true`；部署前核实实际身份与凭据可用性，不自动建账号、生成/显示密码或 secret。

## 本地验证与保留边界

```bash
bash -n deploy.sh backend/scripts/setup_*.sh
node --test tests/deployment.test.mjs tests/velocity-sync.test.mjs
npm run check:migrations
npm run lint
npm run build
npm run check:bundle
node --test tests/migration-replay.test.mjs tests/velocity-sync.test.mjs
```

PB 隔离测试通过 `PB_TEST_BINARY_026` / `PB_TEST_BINARY_034` 指向相应版本二进制。测试不会创建生产身份或改变生产 daemon。

现有 `setup_*.sh` 属于另行批准的初装/配置操作，维护 workflow 不调用它们。旧整机 apt upgrade、Nginx 全站覆写、Certbot/服务安装、自动 superuser 和 SSH 私钥打印流程已从共用维护入口移除。

地图继续使用现有服务端来源白名单和重定向边界，代理不转发站点 Cookie/Authorization；iframe 与直接代理 HTML 维持 sandbox 隔离，不能借部署取消来源约束。OAuth、AI、MCSM、地图供应者和管理员的真实生产验收仍以各自实际证据为准。

### 维护端点与环境重叠

维护 guard、持久 deployment.json（成功与失败）和锁只使用已核定普通私有文件；预检、读取和实际写入都拒绝末级或父路径别名、断链及多链接文件。写入用不跟随链接的文件描述符，核对已打开的文件后才截断，权限保持 0600。预检后出现的别名仍会拒绝，不能把失败记成 deployed。

产物的每个相对链接必须完整解析到发布清单内的文件或目录；包内部链接和 .bin 可用，引用保留的环境、数据、未交付文件、断链或外部路径被拒绝。发布产物不包含 .env 或 .env.*。安装前一次核对所有替换目标及父路径，再开始删除，避免后面的目标无效时先删除前面的产物。

实际 WorkingDirectory、EnvironmentFile 和明确运行环境文件清单仍须从生产库存核实。当前实现选择在替换前拒绝目录内 .env/.env.* 或 configurationFiles 与产物的重叠，包含 backend/scripts/.env；其字节、权限与旧产物保持。该位置可记录在配置清单，但不能借此通过安装；需在原流程内裁定安全保留方案后才能上线，不迁移或覆写环境以绕过拒绝。根与 backend 的 .env 沿明确配置清单私有备份，应用恢复与配置恢复分别核对；拒绝不算部署成功。

Mixed installed baselines and recovery
-------------------------------------

A candidate revision identifies candidate code. An old mixed host is identified
by a stopped, immutable snapshot instead of an invented Git revision. The
`baseline.kind = "mixed"` branch requires `sourceRevision: null`, an exact
`snapshotId`, a private `snapshotDirectory`, and the exact retained and
source-absent migration lists. `previousRevision` is omitted only in this
separately bound branch. The full Git baseline branch remains available.

A snapshot binds every application component and missing component, DB/WAL and
media, the actual PocketBase binary, explicit unit/inline environment and nginx
configuration, modes and configuration ownership metadata, and database
schema/history/counts. A hash of these facts is its immutable ID. An online file
inventory or `baselineReviewed` alone cannot satisfy this contract. Preflight,
backup, rehearsal and installation all check the binding and refuse drift.
A new stopped backup must match the approved immutable ID before installation.

The only observed extra migration accepted by the mixed branch is
`1765100008_add_velocity_advanced.js` with SHA256
`85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c`.
It must exist byte for byte and already be applied in the same snapshot. It
remains a target history component, separate from candidate-owned artifacts;
it is never executed from the candidate, rolled down, or imported as project
source. The source-absent ledger observations
`1770817921_updated_users.js`, `1770818121_updated_users.js`, and
`1770818775_updated_users.js` are retained without generating source files or
rewriting history. Their original provenance remains unknown. New unknown
files/ledger entries or mismatched applied state refuse before service changes.
Production use still requires explicit release authorization for this branch.

The new forward migration reconciles the two observed text selection fields
and adds three missing optional number fields before the existing runtime
normalizer. Valid old values and record IDs are preserved; unknown types and
invalid values reject the transaction. Missing numbers have PocketBase's zero
(unconfigured) value, which is not evidence of actual Java configuration.
The maintenance guard keeps synchronization paused until separately authorized.

Raw snapshots can only be restored unchanged in a new isolated location.
Configuration is restored under `isolated-configuration/` using its absolute
path mapping, with modes and original ownership verified and ownership metadata retained separately;
this command never writes live configuration. A distinct safe recovery set
binds the original snapshot ID, forward migrated DB/media, candidate application
manifest and revision, configuration, and preexisting approved identity records.
It has its own recovery ID. Missing or mismatched role flags refuse; these tools
never provision identities. The raw snapshot is not relabeled as safe. A failed
safe rehearsal stops installation; website services may remain stopped and the
old daemon must remain stopped. There is no automatic production restore.
Neither local rehearsal nor an identity list proves real credentials, actual
service authentication, Java/player continuity, or production authorization.

An explicitly supplied private `recoveryWorkingCopy` can carry previously authorized identity provisioning inside the existing rehearsal step. Source records, relationships and media must match the raw snapshot; only roster-bound identity additions and role changes are allowed. The tool verifies these changes and never creates accounts or changes flags. Without such a verified copy or already valid roles, rehearsal fails. SQLite inspection uses private disposable DB/WAL copies so reading a stopped WAL-mode snapshot never creates sidecars in the immutable original.

The governed local verification supplies `PB_RETAINED_HISTORY_FILE` pointing to the private exact historical byte evidence. That file is read as a retained-byte fixture and never executed or included in candidate source. Without the private input the exact-history adapter proof is skipped and its mixed-history result is not verifiable. Normal PB schema and safe-recovery tests still run. Text conversion saves existing records through PocketBase, so its normal `updated` timestamp may advance; content, IDs and relationships are preserved.
