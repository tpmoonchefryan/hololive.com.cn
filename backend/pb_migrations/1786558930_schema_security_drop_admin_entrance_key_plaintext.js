/// <reference path="../pb_data/types.d.ts" />
/**
 * 删除 system_settings.admin_entrance_key，只保留哈希。
 *
 * 上一个迁移把明文字段标记为 hidden 之后，实测发现 PocketBase 会把 hidden 字段
 * 从非超管的写入里**静默剔除**：请求返回 200，值却没落库。设置页改密钥时
 * 哈希写得进、明文写不进，两者从此分叉，而 AdminGuard 在哈希缺失时会回退到
 * 明文——那就是一颗锁死后台的地雷。
 *
 * 这个字段已经没有读者：AdminGuard 只比对哈希，设置页从 URL 取当前密钥
 * （能进到那个页面就说明 URL 已通过校验）。留着只有走样的风险，故删除。
 *
 * 换个思路也解决不了：system_settings 必须公开可读（AdminLogin 与
 * AnalyticsInjector 在未登录时就要读它），而 PocketBase 没有字段级读规则；
 * AdminGuard 又在登录前运行，它需要的值必然是公开的。所以“公开哈希 + 不存明文”
 * 是这个约束下唯一自洽的形态。
 *
 * Affects:
 * - collections: system_settings
 * - fields/rules/indexes: 删除 text 字段 admin_entrance_key，其余不动
 *
 * Compatibility:
 * - 需前端配套（设置页不再写明文）。AdminGuard 早已只认哈希，
 *   字段消失后它读到 undefined，行为不变。
 *
 * Data Volume:
 * - small（单例记录）
 *
 * Rollback:
 * - 结构可逆，**数据不可逆**：哈希无法还原明文，回滚只能重建空字段
 *   （因此 required 设为 false，否则已有记录会保存失败）。
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    if (!collection.fields.find((f) => f.name === "admin_entrance_key")) return;

    collection.fields = collection.fields.filter(
      (f) => f.name !== "admin_entrance_key",
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    if (collection.fields.find((f) => f.name === "admin_entrance_key")) return;

    collection.fields.add(
      new Field({
        id: "text_sys_admin_key",
        name: "admin_entrance_key",
        type: "text",
        system: false,
        // 明文已不可恢复，这里只能重建空字段，故不能沿用原本的 required: true
        required: false,
        presentable: false,
        hidden: false,
        primaryKey: false,
        autogeneratePattern: "",
        pattern: "",
        min: 0,
        max: 255,
      }),
    );
    app.save(collection);
  },
);
