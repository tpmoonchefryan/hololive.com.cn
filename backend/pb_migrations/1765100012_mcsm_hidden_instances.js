/**
 * 为 mcsm_config 集合添加 hidden_instances 字段
 * 用于在公开页面隐藏指定实例
 */
migrate((app) => {
    const collection = app.findCollectionByNameOrId("mcsm_config");

    collection.fields.push({
        "hidden": false,
        "id": "json_mcsm_hidden",
        "maxSize": 50000,
        "name": "hidden_instances",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
    });

    app.save(collection);

    // 为已有记录设置默认值
    try {
        const records = app.findAllRecords("mcsm_config");
        for (const record of records) {
            if (!record.get("hidden_instances")) {
                record.set("hidden_instances", []);
                app.save(record);
            }
        }
    } catch (err) {
        app.logger().warn("Failed to set default hidden_instances", err);
    }
}, (app) => {
    const collection = app.findCollectionByNameOrId("mcsm_config");
    const field = collection.fields.find(f => f.name === "hidden_instances");
    if (field) {
        collection.fields = collection.fields.filter(f => f.name !== "hidden_instances");
        app.save(collection);
    }
});
