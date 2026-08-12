#!/usr/bin/env python3
"""Microsoft OAuth 客户端密钥健康检查。

2026-08 的事故起因：Azure 应用注册的客户端密钥到期，PocketBase 的 OAuth
令牌交换随之失败，而前端把这个错误显示成“登录失败，请检查邮箱和密码”，
于是所有人被挡在后台外面，排查方向也被误导了很久。

这个脚本做两件事：
  1. 用当前密钥向 Azure 发一次 client_credentials 请求，直接验证它还能不能用；
  2. 如果配置了到期日，在到期前若干天就开始预警——只靠第 1 条的话，
     等探测失败时人已经被锁在外面了。

密钥在运行时直接从 PocketBase 的 SQLite 库读取，不落任何新副本，
也绝不写进日志（只输出前 3 后 2 位的指纹用于核对）。

退出码： 0=正常  1=预警  2=严重（密钥已失效）  3=检查本身失败（不代表密钥有问题）

环境变量：
  PB_DATA_DB                 data.db 路径，默认 /var/www/hololive.com.cn/backend/pb_data/data.db
  MS_OAUTH_SECRET_EXPIRES_ON 密钥到期日 YYYY-MM-DD，配置后启用提前预警
  MS_OAUTH_WARN_DAYS         提前多少天开始预警，默认 30
  MS_OAUTH_WEBHOOK           可选，POST 一条 JSON 告警到该地址
"""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

DB_PATH = os.environ.get(
    "PB_DATA_DB", "/var/www/hololive.com.cn/backend/pb_data/data.db"
)
WARN_DAYS = int(os.environ.get("MS_OAUTH_WARN_DAYS", "30"))
EXPIRES_ON = os.environ.get("MS_OAUTH_SECRET_EXPIRES_ON", "").strip()
WEBHOOK = os.environ.get("MS_OAUTH_WEBHOOK", "").strip()

# 这两个码专指“密钥本身无效/过期”，与权限、同意、配额等问题区分开
SECRET_FAULT_CODES = ("AADSTS7000222", "AADSTS7000215")

OK, WARN, CRITICAL, CHECK_FAILED = 0, 1, 2, 3


def log(level, message):
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"[{stamp}] [MSOAuthSecret] {level}: {message}", flush=True)


def fingerprint(secret):
    """只暴露足以核对身份的最少信息。"""
    if len(secret) < 8:
        return "<too-short>"
    return f"{secret[:3]}...{secret[-2:]} (len={len(secret)})"


def load_provider():
    """从 PocketBase 库里读出 microsoft provider 配置（只读打开，不影响运行中的实例）。"""
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT options FROM _collections WHERE name='users'"
        ).fetchone()
    finally:
        con.close()

    if not row or not row[0]:
        raise RuntimeError("users 集合没有 options，PocketBase 结构可能已变更")

    options = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    for provider in options.get("oauth2", {}).get("providers", []):
        if provider.get("name") == "microsoft":
            return provider
    raise RuntimeError("users 集合里没有启用 microsoft OAuth2 provider")


def tenant_from(provider):
    auth_url = provider.get("authURL", "")
    marker = "microsoftonline.com/"
    if marker in auth_url:
        return auth_url.split(marker, 1)[1].split("/", 1)[0]
    # PocketBase 默认使用 /common/；单租户配置会在 authURL 里带上 tenant GUID
    return "common"


def probe(provider):
    """回 (状态, 说明)。网络故障归为 CHECK_FAILED，不能算密钥有问题。"""
    tenant = tenant_from(provider)
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": provider.get("clientId", ""),
            "client_secret": provider.get("clientSecret", ""),
            "scope": "https://graph.microsoft.com/.default",
        }
    ).encode()

    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=body,
        method="POST",
    )
    request.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(request, timeout=30):
            return OK, "客户端密钥有效"
    except urllib.error.HTTPError as err:
        raw = err.read() or b"{}"
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {"error_description": raw.decode("utf-8", "replace")[:200]}

        description = (payload.get("error_description") or "").split("\r\n")[0]
        if any(code in json.dumps(payload) for code in SECRET_FAULT_CODES):
            return CRITICAL, f"客户端密钥已失效/过期：{description[:180]}"
        # 其它 AADSTS 错误说明密钥本身通过了校验，问题在权限或同意配置
        return OK, f"密钥有效（另有非密钥类错误：{description[:120]}）"
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return CHECK_FAILED, f"无法连接 Azure，本次检查未完成：{err}"


def days_until_expiry():
    if not EXPIRES_ON:
        return None
    try:
        return (date.fromisoformat(EXPIRES_ON) - date.today()).days
    except ValueError:
        log("WARN", f"MS_OAUTH_SECRET_EXPIRES_ON 格式无法解析：{EXPIRES_ON!r}")
        return None


def notify(status, message):
    if not WEBHOOK:
        return
    payload = json.dumps(
        {"service": "hololive.com.cn", "check": "ms-oauth-secret",
         "status": status, "message": message}
    ).encode()
    request = urllib.request.Request(WEBHOOK, data=payload, method="POST")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=15):
            pass
    except Exception as err:  # 告警发不出去不应该让检查本身失败
        log("WARN", f"webhook 推送失败：{err}")


def main():
    try:
        provider = load_provider()
    except Exception as err:
        log("ERROR", f"读取 provider 配置失败：{err}")
        return CHECK_FAILED

    log("INFO", f"clientId={provider.get('clientId')} secret={fingerprint(provider.get('clientSecret', ''))}")

    status, detail = probe(provider)
    remaining = days_until_expiry()

    if status == CRITICAL:
        log("ERROR", detail)
        log("ERROR", "后台 SSO 登录此刻已不可用。到 Azure 门户新建客户端密钥，"
                     "再到 PocketBase 的 users 集合 OAuth2 设置里替换。")
        notify("critical", detail)
        return CRITICAL

    if status == CHECK_FAILED:
        log("WARN", detail)
        return CHECK_FAILED

    if remaining is not None:
        if remaining < 0:
            log("WARN", f"记录的到期日 {EXPIRES_ON} 已过，但探测显示密钥仍有效——"
                        "说明到期日配置过期了，请更新 MS_OAUTH_SECRET_EXPIRES_ON。")
            notify("warning", f"到期日配置 {EXPIRES_ON} 与实际不符")
            return WARN
        if remaining <= WARN_DAYS:
            message = f"客户端密钥将于 {EXPIRES_ON} 到期，剩余 {remaining} 天"
            log("WARN", message)
            notify("warning", message)
            return WARN
        log("INFO", f"{detail}；距到期日 {EXPIRES_ON} 还有 {remaining} 天")
        return OK

    log("INFO", f"{detail}（未配置 MS_OAUTH_SECRET_EXPIRES_ON，无法提前预警）")
    return OK


if __name__ == "__main__":
    sys.exit(main())
