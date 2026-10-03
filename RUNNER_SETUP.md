# 既有 GitHub Self-Hosted Runner 核对

现有维护工作流沿用 `main` push 和手动入口。Runner 的注册、安装、用户与权限配置属于另行批准的初装操作；本指南不证明主机已完成安装或授权。

维护前核对 GitHub 中 runner 在线状态及实际仓库、标签、主机身份、服务用户与工作目录。名称不能证明物理目标。确认本次获准 SHA、真实 Actions run，以及仓库 `DEPLOY_CONFIG` 指向的主机 root 所有私有 JSON 配置；配置与有限目录、网站服务、PB 版本、环境文件、备份及恢复条件对应同一目标。

仅核对执行原有限维护所需的非交互权限，包括已核定网站服务的 stop/start/restart。已有免密 sudo、旧 webhook 清理或初装状态须由实际证据确认，不能由历史文档认定。缺权限时停止该动作并提交具体缺项，不自行扩大 sudo 或安装服务。

部署使用完整 bundle 与 `release.json`，不依赖 runner 工作目录碰巧存在的运行库。初次 mixed 基线在原 backup 步骤、停止 sync 和 PB 后生成封存；恢复、目标角色与实际认证通过后才允许后续服务启动。旧 daemon 的在途安全须先成立，同机 Java Velocity 持续受保护。

具体维护顺序、失败状态、私有证据及恢复边界见 [DEPLOY.md](DEPLOY.md)。当前 runner、配置或某次成功部署的结论均须绑定实际 run 与目标证据。
