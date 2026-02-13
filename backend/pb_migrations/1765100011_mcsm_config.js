/**
 * 创建 mcsm_config 集合（单例模式）
 * 存储 MCSManager 面板连接配置
 */
migrate((app) => {
    const collection = new Collection({
        "id": "pbc_mcsm_config",
        "name": "mcsm_config",
        "type": "base",
        "system": false,
        "listRule": "@request.auth.id != ''",
        "viewRule": "@request.auth.id != ''",
        "createRule": null,
        "updateRule": "@request.auth.id != ''",
        "deleteRule": null,
        "options": {},
        "fields": [
            {
                "autogeneratePattern": "[a-z0-9]{15}",
                "hidden": false,
                "id": "text_mcsm_cfg_id",
                "max": 15,
                "min": 15,
                "name": "id",
                "pattern": "^[a-z0-9]+$",
                "presentable": false,
                "primaryKey": true,
                "required": true,
                "system": true,
                "type": "text"
            },
            {
                "hidden": false,
                "id": "autodate_mcsm_cfg_created",
                "name": "created",
                "onCreate": true,
                "onUpdate": false,
                "presentable": false,
                "system": false,
                "type": "autodate"
            },
            {
                "autogeneratePattern": "",
                "hidden": false,
                "id": "text_mcsm_panel_url",
                "max": 500,
                "min": 0,
                "name": "panel_url",
                "pattern": "",
                "presentable": true,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "text"
            },
            {
                "autogeneratePattern": "",
                "hidden": false,
                "id": "text_mcsm_api_key",
                "max": 500,
                "min": 0,
                "name": "api_key",
                "pattern": "",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "text"
            },
            {
                "hidden": false,
                "id": "bool_mcsm_enabled",
                "name": "enabled",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "bool"
            },
            {
                "hidden": false,
                "id": "number_mcsm_cache_ttl",
                "max": null,
                "min": 1000,
                "name": "public_cache_ttl",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "number"
            },
            {
                "hidden": false,
                "id": "json_mcsm_labels",
                "maxSize": 50000,
                "name": "instance_labels",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "json"
            }
        ],
        "indexes": []
    });

    app.save(collection);

    // 预创建默认记录
    try {
        const col = app.findCollectionByNameOrId("mcsm_config");
        const record = new Record(col, {
            "panel_url": "",
            "api_key": "",
            "enabled": false,
            "public_cache_ttl": 10000,
            "instance_labels": {}
        });
        app.save(record);
    } catch (err) {
        app.logger().warn("Failed to create default mcsm_config record", err);
    }

}, (app) => {
    try {
        const col = app.findCollectionByNameOrId("mcsm_config");
        if (col) app.delete(col);
    } catch (e) { }
});