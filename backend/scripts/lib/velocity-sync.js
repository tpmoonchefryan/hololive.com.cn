import { createHash } from "node:crypto";
import { prepareVelocityConfig } from "./velocity-config.js";

/** One transaction with explicit adapters for safe isolated tests. */
export async function runVelocitySync(adapter, { restartIfChanged = false, forceRestart = false } = {}) {
  // Check before any read, snapshot, JAR fetch, file write or restart.
  // The persistent deployment guard survives daemon startup and realtime events.
  if (await adapter.isProtected?.()) return { status: "protected", restarted: false };
  let stage = "read";
  let snapshot;
  try {
    const { settings, servers, forcedHosts } = await adapter.read();
    stage = "generate";
    const prepared = prepareVelocityConfig(settings, servers, forcedHosts);
    const hash = createHash("sha256").update(prepared.content).digest("hex");
    stage = "snapshot";
    snapshot = await adapter.snapshot();
    stage = "config";
    const configChanged = await adapter.applyConfig(prepared.content);
    stage = "jar";
    const jarChanged = await adapter.applyJar(settings);
    stage = "secret";
    const secretChanged = await adapter.applySecret(prepared.secret);
    stage = "restart";
    const restarted = forceRestart || (restartIfChanged && (configChanged || jarChanged || secretChanged));
    if (restarted) await adapter.restart();
    stage = "metadata";
    const result = { status: configChanged || jarChanged || secretChanged ? "applied" : "unchanged", configChanged, jarChanged, secretChanged, restarted, appliedHash: hash };
    await adapter.report("ok", "", hash);
    return result;
  } catch (cause) {
    const error = new Error(`Velocity ${stage}: ${cause.message}`, { cause });
    error.stage = stage;
    if (snapshot !== undefined) {
      try { await adapter.restore(snapshot); }
      catch (rollbackError) { error.message += `; rollback failed: ${rollbackError.message}`; error.rollbackError = rollbackError; }
    }
    try { await adapter.report("error", error.message); }
    catch (reportError) { error.message += `; error metadata failed: ${reportError.message}`; }
    throw error;
  }
}

/** Production and tests share the same file snapshot, atomic swap and recovery. */
export function createVelocityFiles({ fs, directory, join, ownership = async () => {} }) {
  const names = ['velocity.toml', 'velocity.jar', 'forwarding.secret', '.velocity_jar_ref'];
  const read = async target => {
    try { return await fs.readFile(target); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const swap = async (target, bytes, mode) => {
    await fs.writeFile(`${target}.tmp`, bytes, { mode });
    await fs.chmod(`${target}.tmp`, mode);
    await ownership(`${target}.tmp`);
    await fs.rename(`${target}.tmp`, target);
  };
  return {
    snapshot: async () => {
      const snapshot = [];
      for (const name of names) {
        const target = join(directory, name), bytes = await read(target);
        const mode = bytes === null ? null : (await fs.stat(target)).mode;
        if (bytes !== null) { await fs.writeFile(`${target}.bak`, bytes, { mode }); await fs.chmod(`${target}.bak`, mode); await ownership(`${target}.bak`); }
        snapshot.push({ target, bytes, mode });
      }
      return snapshot;
    },
    restore: async snapshot => {
      const errors = [];
      for (const { target, bytes, mode } of snapshot) {
        try {
          if (bytes === null) await fs.rm(target, { force: true });
          else await swap(target, bytes, mode);
          await fs.rm(`${target}.tmp`, { force: true });
        } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new Error('Unable to restore all Velocity files; .bak snapshots retained', { cause: errors[0] });
    },
    applyConfig: async content => {
      const target = join(directory, 'velocity.toml');
      if ((await read(target))?.toString('utf8') === content) return false;
      await swap(target, content, 0o644); return true;
    },
    applySecret: async secret => {
      const target = join(directory, 'forwarding.secret');
      if ((await read(target))?.toString('utf8').trim() === secret) return false;
      await swap(target, `${secret}\n`, 0o600); return true;
    },
  };
}
