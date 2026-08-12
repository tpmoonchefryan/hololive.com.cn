/// <reference path="../pb_data/types.d.ts" />
/**
 * 停止用公开 API 下发后台入口密钥明文。
 * 新增 admin_entrance_key_hash（公开的 SHA-256），并把 admin_entrance_key 标记为 hidden。
 *
 * Affects:
 * - collections: system_settings
 * - fields/rules/indexes: 新增 text 字段 admin_entrance_key_hash；
 *   admin_entrance_key 的 hidden 由 false 改为 true；对已有记录回填哈希。
 *
 * Compatibility:
 * - 需前端配套（AdminGuard 改为比对哈希）。前端带明文回退分支，
 *   因此“新前端 + 旧数据”和“旧前端 + 新数据”两种中间态都不会锁死后台。
 *   注意 system_settings 的 listRule/viewRule 仍为 ""（公开），
 *   AnalyticsInjector 与 AdminLogin 在未登录时就要读取，这里不做收紧。
 *
 * Data Volume:
 * - small（system_settings 是单例记录，ID 固定为 "1"）
 *
 * Rollback:
 * - 可逆：移除哈希字段并把 hidden 改回 false。明文值全程保留，不会丢。
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    let dirty = false;

    if (!collection.fields.find((f) => f.name === "admin_entrance_key_hash")) {
      collection.fields.add(
        new Field({
          id: "text_sys_admin_key_hash",
          name: "admin_entrance_key_hash",
          type: "text",
          system: false,
          required: false,
          presentable: false,
          hidden: false,
          primaryKey: false,
          autogeneratePattern: "",
          pattern: "",
          min: 0,
          max: 64,
        }),
      );
      dirty = true;
    }

    // FieldsList.add() 按 id 覆盖同名字段，因此这里整体重建以翻转 hidden
    const keyField = collection.fields.find((f) => f.name === "admin_entrance_key");
    if (keyField && keyField.hidden !== true) {
      collection.fields.add(
        new Field({
          id: "text_sys_admin_key",
          name: "admin_entrance_key",
          type: "text",
          system: false,
          required: true,
          presentable: true,
          hidden: true,
          primaryKey: false,
          autogeneratePattern: "",
          pattern: "",
          min: 3,
          max: 255,
        }),
      );
      dirty = true;
    }

    if (dirty) {
      app.save(collection);
    }

    // 从现有明文回填哈希。刻意不在迁移里硬编码密钥值，避免把它带进 git。
    const records = app.findAllRecords("system_settings");
    for (const record of records) {
      const plain = `${record.get("admin_entrance_key") || ""}`;
      if (!plain) continue;
      const expected = $security.sha256(plain);
      if (record.get("admin_entrance_key_hash") !== expected) {
        record.set("admin_entrance_key_hash", expected);
        app.save(record);
      }
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    collection.fields.add(
      new Field({
        id: "text_sys_admin_key",
        name: "admin_entrance_key",
        type: "text",
        system: false,
        required: true,
        presentable: true,
        hidden: false,
        primaryKey: false,
        autogeneratePattern: "",
        pattern: "",
        min: 3,
        max: 255,
      }),
    );

    const hashField = collection.fields.find(
      (f) => f.name === "admin_entrance_key_hash",
    );
    if (hashField) {
      collection.fields = collection.fields.filter(
        (f) => f.name !== "admin_entrance_key_hash",
      );
    }

    app.save(collection);
  },
);
