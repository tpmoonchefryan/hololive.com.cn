/**
 * 提升 translation_config.max_input_chars 默认/存量值到 120000
 * 仅回填当前值缺失或低于 120000 的记录
 */
migrate((app) => {
    try {
        const records = app.findAllRecords("translation_config");
        for (const record of records) {
            const current = Number(record.get("max_input_chars"));
            if (!Number.isFinite(current) || current < 120000) {
                record.set("max_input_chars", 120000);
                app.save(record);
            }
        }
    } catch (err) {
        app.logger().warn("Failed to backfill translation max_input_chars", err);
    }
}, (app) => {
    // no-op rollback
});
