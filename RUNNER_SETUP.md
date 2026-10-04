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

服务库存须提供 DEPLOY.md 所列完整属性，保留所有 Exec 命令的顺序、path、完整 argv、ignore_errors 与五个执行字段。预检绑定配置身份和 EnvFile 路径/选项/内容/权限/属主；原固定 root stop、cleanup-sync、cleanup-java 检查点再次核对，执行字段按旧运行、冻结、停止和新启动分别验证，不能删除执行字段来避开清理误拒。缺项、重复或未知表示、带歧义的 argv/转义拒绝；实际 systemctl 版本能否提供受支持表示尚须目标证据。

清理仍只移除本 run 创建的叶及已空的自建目录，并在原 reload 点读取有效属性。角色/认证失败保留整个失败域，后续较大 run 不覆盖；独立测试成功域不能作为清理失败域或恢复真实主机的许可。完整网站进程身份、Java 连续性与有限 root 成功路径必须由实际目标核实；本地映射、旧无限内存设置或 OOM 为零均不能证明同机玩家安全。

部署预检先通过原安全 control 读取持久部署状态；未解决的 failed 或同旧 run 在读取易变 SQLite ledger 前拒绝。锁内与迁移后的状态和 main 检查仍各自重新读取。SQLite 读取错误仍是失败，不能当成状态拒绝通过。

完整服务配置读取使用 `systemctl show <unit> --all` 请求原全部属性。执行状态支持完整 `0/0` 字符串并保留五个动态字段；`pid=0` 或 `[n/a]` 不证明停止或启动阶段成立。实际特权阶段与目标 systemctl 表示仍须真实证据。

本地直接隔离恢复保留原 EUID/groups、完整唯一 ownership 清单、合法 UID/GID 及复制前拒绝检查。生产路径在原固定 Python 子调用内增加已批准的有限配置/属主/凭据用途，并保留原 `stop`、`cleanup-sync`、`cleanup-java` 三个操作。当前 CI 与指定身份方向已获批准，具体边界见下节；源码、合成 fixture 和本地映射不证明真实 Linux 特权恢复或生产部署成功。

## Finite current-host prerequisites

The existing job uses a secret-free immutable root-owned deployment config
readable by the actual runner group (`0640`). Bind the real repository,
candidate revision, runner user, machine digest, current absolute host roots,
all fourteen properties for each website unit, original Java bindings and the
complete configuration inventory. Record missing configuration as unconfigured;
examples do not grant host or identity authority.

`runnerResources` has exactly `unit`, `CPUQuota`, `MemoryHigh`, `MemoryMax` and
`TasksMax`. The approved finite values are 100%, 1879048192, 2147483648 and 256;
the unit is the observed runner service. Enforcement requires matching
controller files, actual job membership and bounded descendants. Parent CPU
controller absence is a dependent host provisioning stop. The input helper
makes no controller, hierarchy, restart, system package or Java policy change.
Memory/OOM/throttle observations remain available and no automatic increase or
retry occurs. IO enforcement remains unknown.

Provisioned backup/state roots must be private to the actual runner. The fixed
child alone creates root-owned private configuration/material subtrees. Its
root config must declare the reviewed seven existing configuration files and
the two approved absent service EnvFiles. Actual root capability, no-follow
parent/file descriptors, caller process, config inode/hash, candidate manifest,
Actions run, held lock and stopped service/Java evidence are required. A boolean
capability flag does not substitute for readback. No generic helper, sudoers
installer, caller-selected root script or whole-root apply is provided.

Capability inspection is read-only before lock. Raw stopped capture seals the
original bytes and absences; credentials are generated after that seal in the
same backup position, then remain immutable. Two isolated configuration
restorations derive their destinations from that current run and perform owner
and byte/mode readback. Only the two service EnvFiles and exact corresponding
unit EnvironmentFile deltas are delivered during the existing install position.
The original post-health service order is preserved. Failures retain the guard,
partial attempt evidence and failed-run refusal and never report deployed.

Typed D-Bus empty-array proof is required when systemctl omits complex empty
properties; the installed `busctl` must support `--system --json=short` and the
actual signatures. Missing support refuses instead of guessing a binding.
Actual privileged Linux success, effective runner resources, target identity
proof, production run and continuous Java/player evidence must be obtained on
the approved target. Local passing tests cannot provision or prove them.
