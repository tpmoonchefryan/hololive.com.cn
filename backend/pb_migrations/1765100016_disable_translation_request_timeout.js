/**
 * 将 translation_config.request_timeout_ms 统一改为 null（禁用请求级超时）
 * 由前端手动取消控制长任务终止。
 */
migrate((app) => {
    try {
        const records = app.findAllRecords("translation_config");
        for (const record of records) {
            record.set("request_timeout_ms", null);
            app.save(record);
        }
    } catch (err) {
        app.logger().warn("Failed to disable translation request_timeout_ms", err);
    }
}, (app) => {
    try {
        const records = app.findAllRecords("translation_config");
        for (const record of records) {
            const current = Number(record.get("request_timeout_ms"));
            if (!Number.isFinite(current) || current <= 0) {
                record.set("request_timeout_ms", 120000);
                app.save(record);
            }
        }
    } catch (err) {
        app.logger().warn("Failed to rollback translation request_timeout_ms", err);
    }
});
