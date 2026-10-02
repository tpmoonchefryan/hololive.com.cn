import PocketBase from 'pocketbase';
import { createAdminSession } from './adminSession';

/**
 * PocketBase SDK 实例
 * 使用环境变量中的 VITE_POCKETBASE_URL 初始化
 */
const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL);
export const refreshAdminSession = createAdminSession(pb);

export default pb;
