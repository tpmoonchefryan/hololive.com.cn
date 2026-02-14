/**
 * 为 system_settings 增加 PocketBase 公网入口开关
 * - 字段名: enable_pb_public_entry (bool)
 * - 默认: true
 */
migrate((app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    const exists = collection.fields.find((f) => f.name === "enable_pb_public_entry");
    if (!exists) {
        collection.fields.add(new Field({
            "name": "enable_pb_public_entry",
            "type": "bool",
            "system": false,
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {}
        }));
        app.save(collection);
    }

    // 为已有记录补默认值
    try {
        const records = app.findAllRecords("system_settings");
        for (const record of records) {
            const current = record.get("enable_pb_public_entry");
            if (typeof current !== "boolean") {
                record.set("enable_pb_public_entry", true);
                app.save(record);
            }
        }
    } catch (err) {
        app.logger().warn("Failed to backfill enable_pb_public_entry", err);
    }
}, (app) => {
    const collection = app.findCollectionByNameOrId("system_settings");
    if (!collection) return;

    const field = collection.fields.find((f) => f.name === "enable_pb_public_entry");
    if (field) {
        collection.fields = collection.fields.filter((f) => f.name !== "enable_pb_public_entry");
        app.save(collection);
    }
});
