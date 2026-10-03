# 既有 GitHub Self-Hosted Runner 核对

现有维护工作流沿用 `main` push 和手动入口。Runner 的注册、安装、用户与权限配置属于另行批准的初装操作；本指南不证明主机已完成安装或授权。

维护前核对 GitHub 中 runner 在线状态及实际仓库、标签、主机身份、服务用户与工作目录。名称不能证明物理目标。确认本次获准 SHA、真实 Actions run，以及仓库 `DEPLOY_CONFIG` 指向的主机 root 所有私有 JSON 配置；配置与有限目录、网站服务、PB 版本、环境文件、备份及恢复条件对应同一目标。

仅核对执行原有限维护所需的非交互权限，包括已核定网站服务的 stop/start/restart。已有免密 sudo、旧 webhook 清理或初装状态须由实际证据确认，不能由历史文档认定。缺权限时停止该动作并提交具体缺项，不自行扩大 sudo 或安装服务。

部署使用完整 bundle 与 `release.json`，不依赖 runner 工作目录碰巧存在的运行库。初次 mixed 基线在原 backup 步骤、停止 sync 和 PB 后生成封存；恢复、目标角色与实际认证通过后才允许后续服务启动。旧 daemon 的在途安全须先成立，同机 Java Velocity 持续受保护。

具体维护顺序、失败状态、私有证据及恢复边界见 [DEPLOY.md](DEPLOY.md)。当前 runner、配置或某次成功部署的结论均须绑定实际 run 与目标证据。


实际 apply 保持非 root runner，核对其 OS 用户、UID/GID、物理主机与 Actions run；部署脚本内固定无 shell 的 Python 子调用才使用既有有限 root 能力。子调用实际检查 euid=0、SUDO_USER 对应 runner、root 配置身份/摘要、同 run 锁 inode 和候选清单。不能把 runner 名称或某次 sudo 读取成功当作未来写入能力或 Linux 安全结果。不要把整个 apply 改为 root，也不安装通用特权 helper 或扩展权限策略。

有限 root 写入只有批准的 Java/sync 两份 `99-hololive-release-guard.conf` runtime 叶、本次必要目录及实际 sync cgroup 的 freeze/kill。存在同名叶、链接、硬链接、错误身份/组或在途漂移即拒绝；reload 后须读实际生效属性。sync 冻结和全退各等待最多 10 秒，普通 stop 只在冻结中终止并确认全退后收口。候选迁移、角色/合同与实际认证完成后，在原 sync 启动点清自己的 sync 叶/reload/核对还原，启动后核对 Java/文件/job 再清自己的 Java 叶/reload/核对还原。

stop 可能在返回前已部分写保护或尝试冻结。失败保留保护与实际部分范围，较大 run 也拒绝覆盖未解决 failed；不自动解冻、启动旧 sync、撤持久 guard 或删除外来叶/目录。维护目录、配置和 EnvFile 必须由目标批准流程建立，runner 的实际读取与一致备份能力须核实。EnvFile 采用原白名单 `/etc/default/velocity-sync` 和 `/etc/default/mcsm-proxy`，与实际 unit/服务凭据分别绑定；旧 JSON 方案不能执行。

长期人类与两份独立 `users` 服务身份、私有 credential/process.env 来源、root 配置、私有目录、明确 EnvFiles 及最终外部动作尚未齐。临时迁移 superuser 创建/删除已有有限授权也不等于这些前提成立。独立 PB/SQLite 测试与本地有限 host 映射只证明各自实际结果，不证明 Linux 冻结/杀组、生产停服或 Java/玩家全过程连续性。实际机器 UID/GID、账号标识、凭据和主机细节仅保留在私有证据。
