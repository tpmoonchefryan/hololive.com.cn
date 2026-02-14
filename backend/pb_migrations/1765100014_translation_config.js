/**
 * 创建 translation_config 集合（单例）
 * 管理翻译引擎配置（免费翻译 / AI Provider）
 */
migrate((app) => {
    const collection = new Collection({
        "id": "pbc_translation_config",
        "name": "translation_config",
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
                "id": "text_trans_cfg_id",
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
                "id": "autodate_trans_cfg_created",
                "name": "created",
                "onCreate": true,
                "onUpdate": false,
                "presentable": false,
                "system": false,
                "type": "autodate"
            },
            {
                "hidden": false,
                "id": "autodate_trans_cfg_updated",
                "name": "updated",
                "onCreate": true,
                "onUpdate": true,
                "presentable": false,
                "system": false,
                "type": "autodate"
            },
            {
                "hidden": false,
                "id": "bool_trans_enabled",
                "name": "enabled",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "bool"
            },
            {
                "hidden": false,
                "id": "select_trans_engine",
                "maxSelect": 1,
                "name": "engine",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "select",
                "values": [
                    "free",
                    "ai"
                ]
            },
            {
                "hidden": false,
                "id": "select_trans_provider",
                "maxSelect": 1,
                "name": "ai_provider",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "select",
                "values": [
                    "right_code"
                ]
            },
            {
                "autogeneratePattern": "",
                "hidden": false,
                "id": "text_trans_rc_base",
                "max": 500,
                "min": 0,
                "name": "right_code_base_url",
                "pattern": "",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "text"
            },
            {
                "autogeneratePattern": "",
                "hidden": false,
                "id": "text_trans_rc_key",
                "max": 2048,
                "min": 0,
                "name": "right_code_api_key",
                "pattern": "",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "text"
            },
            {
                "autogeneratePattern": "",
                "hidden": false,
                "id": "text_trans_rc_model",
                "max": 120,
                "min": 0,
                "name": "right_code_model",
                "pattern": "",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "text"
            },
            {
                "hidden": false,
                "id": "select_trans_rc_endpoint",
                "maxSelect": 1,
                "name": "right_code_endpoint",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "select",
                "values": [
                    "responses",
                    "chat_completions"
                ]
            },
            {
                "hidden": false,
                "id": "number_trans_timeout",
                "max": null,
                "min": 1000,
                "name": "request_timeout_ms",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "number"
            },
            {
                "hidden": false,
                "id": "number_trans_max_input",
                "max": null,
                "min": 100,
                "name": "max_input_chars",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "number"
            },
            {
                "hidden": false,
                "id": "select_trans_fill_policy",
                "maxSelect": 1,
                "name": "fill_policy",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "select",
                "values": [
                    "fill_empty_only",
                    "overwrite_target"
                ]
            },
            {
                "hidden": false,
                "id": "bool_trans_enable_cache",
                "name": "enable_cache",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "bool"
            },
            {
                "hidden": false,
                "id": "number_trans_cache_ttl",
                "max": null,
                "min": 1000,
                "name": "cache_ttl_ms",
                "presentable": false,
                "required": false,
                "system": false,
                "type": "number"
            }
        ],
        "indexes": []
    });

    app.save(collection);

    // 预创建默认记录（单例）
    try {
        const col = app.findCollectionByNameOrId("translation_config");
        const record = new Record(col, {
            "enabled": true,
            "engine": "free",
            "ai_provider": "right_code",
            "right_code_base_url": "https://www.right.codes/codex/v1",
            "right_code_api_key": "",
            "right_code_model": "gpt-5.2",
            "right_code_endpoint": "responses",
            "request_timeout_ms": 20000,
            "max_input_chars": 30000,
            "fill_policy": "fill_empty_only",
            "enable_cache": true,
            "cache_ttl_ms": 1800000
        });
        app.save(record);
    } catch (err) {
        app.logger().warn("Failed to create default translation_config record", err);
    }
}, (app) => {
    try {
        const col = app.findCollectionByNameOrId("translation_config");
        if (col) app.delete(col);
    } catch (e) { }
});
