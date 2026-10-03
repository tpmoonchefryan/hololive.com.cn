# hololive.com.cn 项目入口

## 工作范围与权威

本仓应用代码位于当前目录。受治理检出以父级平台 `AGENTS.md` 的项目映射为入口；平台容器不是本应用仓库。先读平台规则，再通过引擎读取本分区的实时 `status`、完整 `work-list` 和相关 `work-show`。

| 项目 | 入口 |
| --- | --- |
| 分区 / 编号前缀 | `hololive.com.cn` / `TCRN-HOLOLIVE-CN` |
| 本地链 | 平台根下 `.tcrn-workspace/hololive.com.cn/workspace` |
| 签署目录 | 平台根下 `.tcrn-workspace/hololive.com.cn/attestations` |
| 引擎 | 通过父级平台入口和当前分区配置定位的已验证安装版；接入版本 `1.2.1`，实际要求读取本分区设置 |
| Helper | 通过父级平台入口定位的已验证安装版 Helper |
| 首个 INIT | `TCRN-HOLOLIVE-CN-INIT-001` / `work:97ad7cccb09fccd437d26f5a` |
| 接入与范围批准 | `TCRN-HOLOLIVE-CN-MIN-001` / `minutes:24b2f4744d4b7b4007c4375a` |

调用前把平台路径和签署目录解析为绝对路径。链只由已验证引擎 CLI 写入，每次使用 fresh numeric CAS、实际 actor、UTC 时间和绝对 `attest-dir`，写后回读。不得手改控制树，也不得以相邻源码仓替代安装版引擎或 helper。

## 实施与交付

- 当前 INIT 覆盖审查 F01–F17；完整范围、依赖、文件及验证要求以 live `work-show` 为准。
- 主线程编排，经济代理按获批的完整 Epic/Story Pack 实施，新实例汇总验收。派工前读取实时 `dispatch-mode-list`，新轮使用 `forkTurns: none`。详见平台 `platform-governance-detail.md` 与 `dispatch-readiness-convention.md`。
- 按已批准的一条整合分支 `codex/hololive-init-001` 串行整合；保留工作树中已有改动。验证与收官遵循平台 `delivery-cadence-convention.md`，真实命令结果回写本分区。
- 视觉工作读取平台 `design-authority-convention.md` 和本 Story 的适用边界。项目视觉来源未裁定时，只暂停依赖该来源的动作并说明具体缺项。
- 代码身份：`tpmoonchefryan <253097889+tpmoonchefryan@users.noreply.github.com>`，不添加 `Co-Authored-By`。
- 本次批准包括本地修复、必要验证和有条件解耦；推送、发布、生产操作及真实第三方账号操作遵守平台既有独立授权边界。

本地审查证据与接入回执通过相关 live `work-show` 定位；它们不代替实时链。公开仓库文档不得嵌入本机私有路径、凭据或生产数据。
