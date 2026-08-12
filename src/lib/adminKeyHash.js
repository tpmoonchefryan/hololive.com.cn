/**
 * 后台入口密钥的哈希工具
 *
 * 入口密钥是"隐蔽性"防护（猜不到 URL 就看不到登录页），不是认证凭据。
 * 但它原先以明文存放在 system_settings 里，而该集合的 listRule/viewRule 是 ""（公开），
 * 任何人一条未认证请求即可取得，隐蔽性完全失效。
 *
 * 现在数据库只公开 SHA-256 哈希（admin_entrance_key_hash），明文字段标记为 hidden
 * 不再经 API 下发；前端用 WebCrypto 对 URL 片段做哈希后比对。
 *
 * 注意：crypto.subtle 只在安全上下文可用（HTTPS 或 localhost），生产与本地开发都满足。
 */
export async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
