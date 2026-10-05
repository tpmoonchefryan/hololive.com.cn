import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Shared key structure; localized leaves are ordered zh, en, ja. Identical
// strings are shared. A null slot means that locale did not define the key;
// unequal subtree shapes remain literal locale values, preserving namespaces.
const messages = {
  "common": {
    "serverInfo": ["服务器信息", "Server Info", "サーバー情報"],
    "pagination": {
      "label": ["分页", "Pagination", "ページ切替"],
      "prev": ["上一页", "Previous page", "前のページ"],
      "next": ["下一页", "Next page", "次のページ"],
      "info": ["第 {{page}} / {{total}} 页 · 共 {{count}} 条", "Page {{page}} / {{total}} · {{count}} records", "{{page}} / {{total}} ページ · {{count}} 件"]
    },
    "pinned": ["置顶", "Pinned", "固定"],
    "icp": "粤ICP备2023071182号-1",
    "routeLoading": ["加载中...", "Loading...", "読み込み中..."],
    "actions": {
      "close": ["关闭", "Close", "閉じる"]
    },
    "banner": {
      "details": ["(查看详情)", "(View Details)", "(詳細を見る)"],
      "close": ["关闭公告", "Close announcement", "お知らせを閉じる"]
    },
    "draft": {
      "title": ["未保存的更改", "Unsaved changes", "未保存の変更"],
      "message": ["离开将丢弃未保存的更改。", "Leaving will discard your unsaved changes.", "移動すると未保存の変更が破棄されます。"],
      "discard": ["丢弃并离开", "Discard and leave", "破棄して移動"],
      "keepEditing": ["继续编辑", "Keep editing", "編集を続ける"]
    },
    "feedback": {
      "confirmTitle": ["请确认操作", "Please confirm this action", "操作を確認してください"],
      "confirm": ["确认", "Confirm", "確認"],
      "cancel": ["取消", "Cancel", "キャンセル"]
    },
    "errorPage": {
      "backHome": ["返回首页", "Back to Home", "ホームに戻る"],
      "imageAlt": ["错误 {{code}}", "Error {{code}}", "エラー {{code}}"]
    },
    "navbar": {
      "home": ["首页", "Home", "ホーム"],
      "docs": ["文档", "Docs", "ドキュメント"],
      "siteTitle": "莱恩的MC笔记",
      "logoAlt": ["站点图标", "Site Logo", "サイトロゴ"],
      "openMenu": ["打开菜单", "Open Menu", "メニューを開く"],
      "closeMenu": ["关闭菜单", "Close Menu", "メニューを閉じる"]
    },
    "languageNames": {
      "en": "English",
      "zh": "中文",
      "ja": "日本語"
    },
    "footer": {
      "copyright": "All rights reserved.",
      "powered_by": "Powered by PocketBase & React",
      "contactUs": ["联系我们", "Contact Us", "お問い合わせ"],
      "contactAdmin": ["联系网站管理员", "Contact Admin", "管理者に連絡"],
      "specialThanks": ["特别鸣谢&一些有用的信息", "Special Thanks & Info", "スペシャルサンクス & 情報"],
      "holoCNProject": "（旧）hololive China Project",
      "brandName": "hololive",
      "officialSite": ["官方网站", "Official Website", "公式サイト"],
      "social": {
        "youtube": "YouTube",
        "x": "X",
        "tiktok": "TikTok"
      },
      "coverDisclaimer": ["hololive™/hololive production™是日本COVER株式会社旗下的经纪公司品牌。本网站为个人运营非官方站点，请仔细甄别内容。", "hololive™ & hololive production™ are trademarks of COVER Corporation. This is a personally operated unofficial site; please verify content independently.", "hololive™/hololive production™はカバー株式会社の商標です。当サイトは個人運営の非公式サイトであり、内容の真偽については各自でご判断ください。"],
      "usadaKensetsu": ["兔田重工", "Usada Kensetsu", "兎田建設"],
      "thanksStaff": ["Usada_kidd 等所有帮助过该网站的原字幕组成员", "Usada_kidd and all former sub-members who helped", "Usada_kiddをはじめ、協力してくれた旧字幕組の全メンバー"],
      "personalSpace": ["月球厨师莱恩的个人空间", "TPMOONCHEFRYAN's Bilibili Space", "TPMOONCHEFRYANのBilibili個人ページ"],
      "oldFansub": ["（旧）幻夜字幕组", "Former 幻夜字幕组", "旧・幻夜字幕組"],
      "oldTalents": ["（旧）hololive China Talents", "Former hololive China Talents", "旧・hololive China Talents"],
      "copyrightOwner": ["Copyright © 2025 月球厨师莱恩", "Copyright © 2025 TPMOONCHEFRYAN", "Copyright © 2025 TPMOONCHEFRYAN"]
    }
  },
  "home": {
    "loading": ["加载中...", "Loading...", "読み込み中..."],
    "empty": ["暂无内容", "No content yet", "コンテンツはまだありません"],
    "error": ["首页加载失败，请稍后重试。", "Unable to load the homepage. Please try again.", "ホームページを読み込めませんでした。再試行してください。"],
    "retry": ["重试", "Try again", "再試行"],
    "common": {
      "loading": ["加载中...", "Loading...", "読み込み中..."],
      "empty": ["暂无内容", "No Content", "コンテンツはありません"]
    },
    "hero1": {
      "title": "HololiveCN MC Server",
      "subtitle": ["欢迎访问 HololiveCN MC 服务器。请勿泄露您的密码/凭据，也不要向任何人支付费用，谨防诈骗。", "Welcome to the HololiveCN MC Server. Please do not reveal your password credentials or pay any fees to anyone, and beware of scams.", "HololiveCN MC サーバーへようこそ。パスワードや認証情報を漏らしたり、金銭を支払ったりしないようご注意ください。詐欺にご注意ください。"]
    },
    "hero2": {
      "title": ["Pekoland", "Pekoland", "ペコランド"],
      "subtitle": ["兔田重工所在地，兔组大本营", "Location of Usada Kensetsu, Base of the Rabbits", "兎田建設の所在地、野うさぎの本拠地"],
      "mapButton": ["转到地图", "Go to Map", "地図へ移動"]
    }
  },
  "docs": {
    "title": ["文档", "Documentation", "ドキュメント"],
    "subtitle": ["服务器使用指南与相关信息", "Server Guide and Related Information", "サーバーガイドと関連情報"],
    "common": {
      "loading": ["加载中...", "Loading...", "読み込み中..."],
      "backToDocs": ["返回文档中心", "Back to Docs", "ドキュメントに戻る"]
    },
    "cards": {
      "announcements": {
        "title": ["网站公告", "Website Announcements", "ウェブサイトのお知らせ"],
        "description": ["查看最新的网站公告和重要通知", "Check the latest announcements and important notices", "最新のお知らせや重要なお知らせを確認します"]
      },
      "serverInfo": {
        "title": ["服务器信息", "Server Info", "サーバー情報"],
        "description": ["查看服务器信息和地图", "View server information and maps", "サーバー情報とマップを確認します"]
      },
      "documents": {
        "title": ["其他文档", "Other Documents", "その他のドキュメント"],
        "description": ["浏览其他相关文档", "Browse other related documents", "その他の関連ドキュメントを閲覧します"]
      }
    },
    "sections": {
      "gettingStarted": {
        "title": ["快速开始", "Getting Started", "はじめに"],
        "content": ["欢迎来到 HololiveCN MC 服务器！这里是您开始游戏之旅的起点。", "Welcome to HololiveCN MC Server! This is where your journey begins.", "HololiveCN MC サーバーへようこそ！ここがあなたの旅の始まりです。"]
      },
      "rules": {
        "title": ["服务器规则", "Server Rules", "サーバールール"],
        "content": ["请遵守服务器规则，共同维护良好的游戏环境。", "Please follow the server rules to maintain a good gaming environment.", "サーバールールを守り、良好なゲーム環境を維持してください。"]
      },
      "faq": {
        "title": ["常见问题", "FAQ", "よくある質問"],
        "content": ["这里收集了玩家们最常遇到的问题和解答。", "Here are the most frequently asked questions and answers.", "よくある質問と回答をまとめました。"]
      }
    },
    "serverInfo": {
      "empty": ["暂无服务器信息", "No Server Info", "サーバー情報がありません"],
      "unnamed": ["未命名", "Unnamed", "未命名"],
      "status": {
        "title": ["实时状态", "Live Status", "リアルタイムステータス"],
        "online": ["运行中", "Online", "オンライン"],
        "offline": ["离线", "Offline", "オフライン"],
        "players": ["在线人数", "Players", "オンライン人数"],
        "latency": ["在线/延迟", "Online/Latency", "オンライン/レイテンシ"],
        "latencyOnline": ["在线", "Online", "オンライン"],
        "latencyOffline": ["离线/未知状态", "Offline/Unknown", "オフライン/不明"],
        "fetching": ["正在获取服务器状态...", "Fetching server status...", "サーバーステータスを取得中..."],
        "fetchFailed": ["获取服务器状态失败，请稍后重试", "Failed to fetch server status. Please retry later.", "サーバーステータスの取得に失敗しました。後でもう一度お試しください"],
        "offlineDesc": ["服务器当前不可用或无法连接", "Server is currently unavailable or unreachable", "サーバーは現在利用できないか、接続できません"],
        "version": ["服务端版本", "Version", "バージョン"],
        "motd": ["服务器标语", "MOTD", "MOTD"]
      },
      "mcsm": {
        "title": ["服务器资源状态", "Server Resource Status", "サーバーリソース状態"],
        "cpu": "CPU",
        "memory": ["内存", "Memory", "メモリ"]
      },
      "map": {
        "loadError": ["加载地图列表失败，请稍后重试", "Failed to load map list, please retry later", "マップ一覧の読み込みに失敗しました。後でもう一度お試しください"],
        "empty": ["暂无地图", "No Maps", "マップがありません"],
        "list": ["地图列表", "Map List", "マップ一覧"],
        "selectOne": ["请选择一个地图", "Please select a map", "マップを選択してください"],
        "fullscreenDialog": ["地图全屏视图", "Map fullscreen view", "マップ全画面表示"],
        "enterFullscreen": ["网页全屏", "Fullscreen", "全画面"],
        "exitFullscreen": ["退出全屏", "Exit Fullscreen", "全画面を終了"],
        "mixedContent": {
          "fullscreenTitle": ["当前页面为 HTTPS，浏览器会拦截 HTTP iframe", "This page is HTTPS, browser blocks HTTP iframe content", "このページはHTTPSのため、ブラウザがHTTP iframeをブロックします"],
          "inlineTitle": ["浏览器已拦截 HTTP 地图内嵌（HTTPS 页面限制）", "Browser blocked embedded HTTP map due to HTTPS restrictions", "HTTPS制限により、HTTPマップの埋め込みがブロックされました"],
          "mapUrl": ["地图地址：{{url}}", "Map URL: {{url}}", "マップURL：{{url}}"],
          "notSet": ["未设置", "Not set", "未設定"],
          "openInNewWindow": ["新窗口打开地图", "Open Map in New Window", "マップを新しいウィンドウで開く"],
          "openInNewWindowShort": ["新窗口打开", "Open in New Window", "新しいウィンドウで開く"]
        }
      }
    },
    "websiteAnnouncements": {
      "loadError": ["加载公告失败，请稍后重试", "Failed to load announcements, please retry later", "お知らせの読み込みに失敗しました。後でもう一度お試しください"],
      "empty": ["暂无公告", "No Announcements", "お知らせはありません"]
    },
    "otherDocuments": {
      "loadError": ["加载文档失败，请稍后重试", "Failed to load documents, please retry later", "ドキュメントの読み込みに失敗しました。後でもう一度お試しください"],
      "empty": ["暂无文档", "No Documents", "ドキュメントはありません"]
    },
    "articleDetail": {
      "loadError": ["加载文章失败，请稍后重试", "Failed to load article, please retry later", "記事の読み込みに失敗しました。後でもう一度お試しください"],
      "notFound": ["文章不存在", "Article Not Found", "記事が見つかりません"],
      "back": ["返回", "Back", "戻る"],
      "updatedAt": ["更新于 {{date}}", "Updated at {{date}}", "{{date}} に更新"]
    }
  },
  "admin": {
    "console": ["控制台", "Console", "コンソール"],
    "backend": ["管理后台", "Administration", "管理画面"],
    "sidebar": {
      "subtitle": ["HololiveCN MC 后台", "HololiveCN MC Admin", "HololiveCN MC 管理"],
      "dashboard": ["总览", "Dashboard", "ダッシュボード"],
      "velocity": ["Velocity 代理", "Velocity Proxy", "Velocity プロキシ"],
      "mcsm": ["MCSM 面板", "MCSM Panel", "MCSM パネル"],
      "posts": ["文章管理", "Posts", "記事管理"],
      "media": ["资源库", "Media", "メディアライブラリ"],
      "home": ["首页管理", "Home Manager", "ホーム管理"],
      "accounts": ["账号管理", "Accounts", "アカウント管理"],
      "whitelist": ["白名单设置", "Whitelist", "ホワイトリスト"],
      "localAccounts": ["当前账号", "Current Account", "現在のアカウント"],
      "logs": ["操作日志", "Logs", "操作ログ"],
      "settings": ["系统设置", "Settings", "システム設定"],
      "announcements": ["公告管理", "Announcements", "お知らせ管理"],
      "serverMaps": ["服务器地图", "Server Maps", "サーバーマップ"],
      "serverInfoFields": ["服务器信息字段", "Server Info Fields", "サーバー情報フィールド"],
      "role": ["管理员", "Admin", "管理者"],
      "backHome": ["回到主页", "Back Home", "ホームへ戻る"],
      "logout": ["安全退出", "Logout", "ログアウト"],
      "loggingOut": ["正在登出...", "Logging out...", "ログアウト中..."]
    },
    "header": {
      "currentAdmin": ["当前管理员", "Current Admin", "現在の管理者"],
      "notLoggedIn": ["未登录", "Not Logged In", "未ログイン"]
    },
    "translationAction": {
      "translate": ["一键翻译", "Auto Translate", "自動翻訳"],
      "translating": ["翻译中...", "Translating...", "翻訳中..."]
    },
    "translationJob": {
      "title": ["翻译进度", "Translation Progress", "翻訳進捗"],
      "overallProgress": ["总进度", "Overall Progress", "全体進捗"],
      "completedUnits": ["完成", "Completed", "完了"],
      "elapsed": ["已耗时", "Elapsed", "経過時間"],
      "currentField": ["字段", "Current Field", "フィールド"],
      "currentTarget": ["目标", "Current Targets", "対象言語"],
      "groupProgress": ["分组", "Task Groups", "グループ"],
      "cancel": ["取消", "Cancel", "中止"],
      "canceling": ["取消中...", "Canceling...", "中止中..."],
      "close": ["关闭", "Close", "閉じる"],
      "status": {
        "idle": ["待开始", "Idle", "待機中"],
        "queued": ["排队中", "Queued", "キュー待ち"],
        "running": ["执行中", "Running", "実行中"],
        "translating": ["翻译中", "Translating", "翻訳中"],
        "canceling": ["取消中", "Canceling", "中止中"],
        "canceled": ["已取消", "Canceled", "中止済み"],
        "succeeded": ["已完成", "Completed", "完了"],
        "partial_success": ["部分完成", "Partially Completed", "一部完了"],
        "failed": ["执行失败", "Failed", "失敗"]
      },
      "toast": {
        "canceled": ["翻译任务已取消", "Translation was canceled", "翻訳タスクを中止しました"],
        "partial": ["翻译完成，部分失败", "Translation completed with partial failures", "翻訳完了（一部失敗）"],
        "precheckTooLong": ["以下字段超过最大长度 {{max}}：{{details}}", "Fields exceed max length {{max}}: {{details}}", "次のフィールドが最大長 {{max}} を超えています: {{details}}"]
      }
    },
    "dashboard": {
      "welcome": ["欢迎来到后台", "Welcome to Dashboard", "管理画面へようこそ"],
      "title": ["服务器控制中心总览", "Server Control Center Overview", "サーバー管理センター概要"],
      "description": ["在这里你可以管理文章、公告、账号与系统设置。右侧卡片会实时反映当前日期与时间，帮助你规划运维与公告发布时间。", "Manage posts, announcements, accounts, and system settings here. The card on the right shows the current date and time to help you plan maintenance and announcements.", "記事、お知らせ、アカウント、システム設定を管理できます。右側のカードは現在の日時を表示し、メンテナンス計画に役立ちます。"],
      "currentTime": ["当前时间", "Current Time", "現在時刻"],
      "stats": {
        "posts": ["文章总数", "Total Posts", "記事総数"],
        "postsDesc": ["已记录的公告、文档和更新日志条目总数。", "Total count of announcements, docs, and changelogs.", "記録されたお知らせ、ドキュメント、更新履歴の総数。"],
        "announcements": ["当前生效公告", "Active Announcements", "有効なお知らせ"],
        "announcementsDesc": ["仅统计设置为启用且时间范围内的横幅公告。", "Only counts enabled banners within valid time range.", "有効かつ期間内のバナーお知らせのみカウント。"],
        "system": ["系统设置", "System Settings", "システム設定"],
        "analyticsConfigured": ["统计已配置（至少启用了一种 Analytics）", "Analytics Configured", "統計設定済み（少なくとも1つ有効）"],
        "analyticsNotConfigured": ["尚未配置统计代码", "Analytics Not Configured", "統計未設定"],
        "systemDesc": ["可在「系统设置」中配置 Google Analytics 与百度统计，以及后台入口 Key。", "Configure Google/Baidu Analytics and Admin Key in 'System Settings'.", "「システム設定」でGoogle/Baidu統計と管理入口キーを設定できます。"]
      },
      "error": {
        "loadFailed": ["加载仪表盘数据失败", "Failed to load dashboard data", "ダッシュボードデータの読み込みに失敗しました"]
      },
      "retry": ["重试", "Retry", "再試行"]
    },
    "settingsPage": {
      "title": ["系统设置", "System Settings", "システム設定"],
      "description": ["管理系统全局配置，包括统计与后台入口 Key。", "Manage global system configurations, including analytics and admin entry key.", "統計や管理入口キーを含む、システム全体の構成を管理します。"],
      "loading": ["加载系统设置中...", "Loading system settings...", "システム設定を読み込み中..."],
      "errorLoadPrefix": ["加载设置失败", "Failed to load settings", "設定の読み込みに失敗しました"],
      "unknownError": ["未知错误", "Unknown error", "不明なエラー"],
      "validation": {
        "keyTooShort": ["后台入口 Key 长度至少 8 位", "Admin Entry Key must be at least 8 characters", "管理入口キーは8文字以上である必要があります"],
        "weakKey": ["请勿使用默认后台入口 Key，请设置新的安全值", "Do not use the default admin key. Please set a secure value.", "既定の管理キーは使用しないでください。安全な値を設定してください。"]
      },
      "interface": {
        "title": ["接口设置", "Interface Settings", "インターフェース設定"],
        "sso": ["SSO 配置 (Microsoft OAuth)", "SSO Config (Microsoft OAuth)", "SSO設定 (Microsoft OAuth)"],
        "ssoDesc": ["Microsoft OAuth 配置通常在 PocketBase 后台面板中完成。", "Microsoft OAuth configuration is usually done in the PocketBase Admin Panel.", "Microsoft OAuth設定は通常、PocketBase管理パネルで行います。"],
        "ssoHint": ["如需配置，请前往 PocketBase Admin 面板 → Settings → OAuth2 Providers → Microsoft", "To configure, go to PocketBase Admin → Settings → OAuth2 Providers → Microsoft", "設定するには、PocketBase Admin → Settings → OAuth2 Providers → Microsoft へ移動してください"],
        "googleId": "Google Analytics ID",
        "googleIdHint": ["格式：G-XXXXXXXXXX（可选，留空则不启用）", "Format: G-XXXXXXXXXX (Optional, leave empty to disable)", "形式: G-XXXXXXXXXX（任意、無効にする場合は空欄）"],
        "baiduId": ["百度统计 ID (Baidu Analytics)", "Baidu Analytics ID", "Baidu Analytics ID"],
        "baiduIdHint": ["请输入 32 位 ID，支持直接粘贴完整 <script> 代码自动提取", "Enter 32-digit ID, or paste the full <script> code to auto-extract", "32桁のIDを入力、または <script> コード全体を貼り付けて自動抽出"],
        "baiduExtracted": ["✓ 已自动从代码中提取 ID", "✓ ID auto-extracted from code", "✓ コードからIDを自動抽出しました"],
        "googlePlaceholder": "G-XXXXXXXXXX",
        "baiduPlaceholder": ["32位ID，或粘贴<script>代码", "32-char ID, or paste <script> snippet", "32文字ID、または<script>コードを貼り付け"]
      },
      "access": {
        "title": ["后台入口设置", "Admin Entry Settings", "管理アクセス設定"],
        "warningTitle": ["重要提示", "Important Notice", "重要なお知らせ"],
        "warningDesc": ["修改此 Key 后，您访问后台的 URL 将立即改变。请确保您记住了新的入口 Key，否则您将无法访问后台管理系统。", "Changing this Key will immediately change your admin access URL. Ensure you remember the new Key, otherwise you may lose access to the admin panel.", "このキーを変更すると、管理画面のURLが即座に変更されます。新しいキーを忘れるとアクセスできなくなる可能性があります。"],
        "keyLabel": ["后台入口 Key *", "Admin Entry Key *", "管理入口キー *"],
        "currentUrl": ["当前访问 URL:", "Current URL:", "現在のURL:"],
        "keyPlaceholder": ["请输入新的后台入口 Key（至少 8 位）", "Enter a new admin key (minimum 8 characters)", "新しい管理入口キーを入力（8文字以上）"],
        "pbPublicEntryLabel": ["PocketBase 公网入口", "PocketBase Public Entry", "PocketBase 公開入口"],
        "pbPublicEntryDesc": ["控制 https://hololive.com.cn/_/ 的公网访问。关闭后将重定向到 /418。", "Controls public access to https://hololive.com.cn/_/. When disabled, visitors are redirected to /418.", "https://hololive.com.cn/_/ への公開アクセスを制御します。無効化すると /418 へリダイレクトされます。"],
        "pbPublicEntryHint": ["仅影响公网的 /_/ 入口，不影响前端通过本地接口访问 PocketBase。", "Only affects the public /_/ entry and does not affect frontend local PocketBase access.", "公開の /_/ 入口のみに影響し、フロントエンドのローカル PocketBase アクセスには影響しません。"],
        "pbPublicEntryOn": ["已开启", "Enabled", "有効"],
        "pbPublicEntryOff": ["已关闭", "Disabled", "無効"]
      },
      "translation": {
        "title": ["翻译管理", "Translation Management", "翻訳管理"],
        "description": ["配置后台翻译引擎。可选择免费翻译 API 或 AI（Right Code）。", "Configure admin translation engine. Choose free translation API or AI (Right Code).", "管理画面の翻訳エンジンを設定します。無料翻訳 API または AI（Right Code）を選択できます。"],
        "enabled": ["翻译功能开关", "Translation Switch", "翻訳機能スイッチ"],
        "enabledOn": ["已启用", "Enabled", "有効"],
        "enabledOff": ["已禁用", "Disabled", "無効"],
        "engineLabel": ["翻译引擎", "Translation Engine", "翻訳エンジン"],
        "engineFree": ["免费翻译 API", "Free Translation API", "無料翻訳 API"],
        "engineAi": "AI API",
        "providerLabel": ["AI 提供商", "AI Provider", "AI プロバイダー"],
        "endpointLabel": ["AI 接口类型", "AI Endpoint Type", "AI エンドポイント種別"],
        "baseUrlLabel": "Right Code Base URL",
        "modelLabel": ["模型名称", "Model", "モデル名"],
        "apiKeyLabel": "Right Code API Key",
        "apiKeyPlaceholder": ["请输入 API Key", "Enter API key", "API Key を入力してください"],
        "timeoutLabel": ["请求超时（毫秒）", "Request Timeout (ms)", "リクエストタイムアウト（ms）"],
        "timeoutHint": ["设置为 0 表示不设置请求超时，仅通过手动取消终止任务。", "Set to 0 to disable request timeout. Jobs are stopped by manual cancel only.", "0 に設定するとリクエストタイムアウトを無効化し、手動キャンセルのみで停止します。"],
        "maxInputLabel": ["单字段最大输入字符数", "Max Input Chars per Field", "フィールドごとの最大入力文字数"],
        "fillPolicyLabel": ["回填策略", "Fill Policy", "反映ポリシー"],
        "fillPolicyFillEmpty": ["仅填充空白目标语言", "Fill Empty Target Languages Only", "空の対象言語のみ補完"],
        "fillPolicyOverwrite": ["覆盖目标语言已有内容", "Overwrite Existing Target Content", "対象言語の既存内容を上書き"],
        "cacheLabel": ["翻译缓存", "Translation Cache", "翻訳キャッシュ"],
        "cacheOn": ["已开启", "Enabled", "有効"],
        "cacheOff": ["已关闭", "Disabled", "無効"],
        "onlyTwoTargetsHint": ["AI 仅返回未提供的两种语言内容", "AI only returns the two missing target languages", "AI は未入力の2言語のみ返します"],
        "test": {
          "title": ["配置测试", "Configuration Test", "設定テスト"],
          "desc": ["测试当前配置是否可连通，并校验 AI 返回结构是否符合预期。", "Verify connectivity and validate whether AI output follows the required structure.", "現在の設定の接続可否と、AI 出力構造の妥当性を検証します。"],
          "placeholder": ["输入用于测试翻译的文本", "Enter sample text for translation test", "翻訳テスト用テキストを入力"],
          "button": ["测试连接与结构", "Test Connectivity & Structure", "接続と構造をテスト"],
          "testing": ["测试中...", "Testing...", "テスト中..."],
          "success": ["翻译配置测试通过", "Translation configuration test passed", "翻訳設定テストに成功しました"],
          "failed": ["翻译配置测试失败", "Translation configuration test failed", "翻訳設定テストに失敗しました"],
          "connectivity": ["连通性：", "Connectivity:", "接続性："],
          "structure": ["结构校验：", "Structure Check:", "構造検証："],
          "ok": ["通过", "Pass", "成功"],
          "failedShort": ["失败", "Fail", "失敗"],
          "errorLabel": ["错误：", "Error: ", "エラー："]
        },
        "errors": {
          "collectionMissing": ["translation_config 集合不存在，请先执行迁移部署。", "translation_config collection not found. Please deploy migrations first.", "translation_config コレクションが見つかりません。先にマイグレーションを適用してください。"]
        }
      },
      "modal": {
        "title": ["确认修改后台入口 Key？", "Confirm Admin Key Change?", "管理キーの変更を確認？"],
        "desc": ["修改后台入口 Key 会立即改变后台访问地址。如果你忘记新地址，可能会暂时无法进入后台。", "Changing the Admin Key will immediately alter the admin URL. If you forget the new address, you may be temporarily locked out.", "管理キーを変更すると、アクセスURLが即座に変更されます。新しいアドレスを忘れると、一時的にロックアウトされる可能性があります。"],
        "currentKey": ["当前 URL Key：", "Current URL Key:", "現在のURLキー:"],
        "dbKey": ["数据库中的旧 Key：", "Old Key in DB:", "DBの旧キー:"],
        "newKey": ["新入口 Key：", "New Entry Key:", "新入口キー:"],
        "newUrl": ["新后台地址：", "New Admin URL:", "新管理URL:"],
        "cancel": ["取消", "Cancel", "キャンセル"],
        "confirm": ["我已知风险，确认修改", "I understand, Change it", "理解して変更する"]
      },
      "save": ["保存设置", "Save Settings", "設定を保存"],
      "saving": ["保存中...", "Saving...", "保存中..."],
      "success": ["设置保存成功！", "Settings saved successfully!", "設定が正常に保存されました！"],
      "error": ["保存失败，请重试", "Failed to save settings, please retry", "保存に失敗しました。再試行してください"]
    },
    "login": {
      "title": ["管理控制台", "Admin Console", "管理コンソール"],
      "subtitle": ["请使用 Microsoft 账号登录", "Please login with Microsoft Account", "Microsoft アカウントでログインしてください"],
      "loading": ["正在跳转...", "Redirecting...", "リダイレクト中..."],
      "microsoftBtn": ["使用 Microsoft 账号登录", "Login with Microsoft", "Microsoft アカウントでログイン"],
      "orDev": ["或（开发模式）", "OR (Dev Mode)", "または（開発モード）"],
      "email": ["邮箱", "Email", "メールアドレス"],
      "password": ["密码", "Password", "パスワード"],
      "emailPlaceholder": "your-admin@example.com",
      "passwordPlaceholder": ["请输入密码", "Enter password", "パスワードを入力"],
      "verifying": ["验证中...", "Verifying...", "確認中..."],
      "passwordBtn": ["使用密码登录", "Login with Password", "パスワードでログイン"],
      "footer": ["只有授权的管理员才能访问此系统", "Only authorized administrators can access this system", "許可された管理者のみがこのシステムにアクセスできます"],
      "alerts": {
        "notWhitelisted": ["您的邮箱未在白名单中，无权访问", "Your email is not whitelisted.", "あなたのメールアドレスはホワイトリストに登録されていません。"],
        "cancelled": ["登录已取消", "Login cancelled", "ログインがキャンセルされました"],
        "configError": ["OAuth2 配置错误", "OAuth2 Config Error", "OAuth2 設定エラー"],
        "networkError": ["网络连接失败", "Network Connection Failed", "ネットワーク接続失敗"],
        "failed": ["登录失败，请检查邮箱和密码", "Login failed, check email and password", "ログインに失敗しました。メールアドレスとパスワードを確認してください"],
        "unknownError": ["未知错误", "Unknown error", "不明なエラー"],
        "missingEmail": ["无法获取用户邮箱信息", "Unable to retrieve user email", "ユーザーメールを取得できませんでした"]
      }
    },
    "users": {
      "title": ["当前管理员账号", "Current Administrator", "現在の管理者アカウント"],
      "subtitle": ["查看当前身份及可信供应说明", "View your identity and trusted provisioning guidance", "現在の認証情報と信頼できる登録手順を確認"],
      "loading": ["加载中…", "Loading…", "読み込み中…"],
      "provision": {
        "title": ["由超管维护授权", "Authorization maintained by a superuser", "スーパーユーザーによる権限管理"],
        "desc": ["账号创建、授权、撤销与删除由受信任的 PocketBase 超管在独立管理通路完成。本站仅显示当前账号，不提供完整管理员名册或账号管理操作。", "A trusted PocketBase superuser manages account creation, authorization, revocation and deletion separately. Only your account is shown here.", "信頼できる PocketBase スーパーユーザーが別の管理経路でアカウントの作成、権限付与、取り消し、削除を行います。このページは現在のアカウントのみを表示し、管理者全員の名簿ではありません。"],
        "service": ["服务身份必须同时具备 is_admin=true 与 service_account=true；人类管理员还须验证身份。", "Service identities require both is_admin=true and service_account=true; human administrators also require verified identity.", "サービスアカウントには is_admin=true と service_account=true の両方が必要です。人間の管理者には本人確認も必要です。"],
        "current": ["当前账号", "Current account", "現在のアカウント"],
        "identity": ["身份类型", "Identity type", "アカウント種別"],
        "humanIdentity": ["人类管理员", "Human administrator", "管理者"],
        "serviceIdentity": ["服务账号", "Service account", "サービスアカウント"],
        "unavailable": ["无法读取当前账号", "Current account unavailable", "現在のアカウントを取得できません"]
      },
      "toggle": {
        "title": ["允许本地账号密码登录", "Allow Local Password Login", "ローカルパスワードログインを許可"],
        "desc": ["此状态由服务端设置决定。关闭后人类管理员不能使用密码认证；受信任服务身份保留独立接入。设置读取失败或缺失时显示未知，登录页关闭密码入口。", "Server state: disabling password login blocks human password authentication. Trusted services retain separate access. Failed or missing settings show unknown and close password entry.", "サーバー設定の状態です。無効の場合、人間の管理者はパスワード認証できません。信頼できるサービスアカウントの独立した接続は維持されます。設定の取得失敗や欠落は不明と表示し、ログイン画面ではパスワード入力を閉じます。"],
        "loading": ["正在读取…", "Reading…", "読み込み中…"],
        "unknown": ["未知（密码入口关闭）", "Unknown (password entry closed)", "不明（パスワード入力は無効）"],
        "on": ["已开启", "Enabled", "有効"],
        "off": ["已关闭", "Disabled", "無効"]
      },
      "table": {
        "email": ["邮箱地址", "Email", "メールアドレス"]
      }
    },
    "homeManager": {
      "title": ["首页分段管理", "Home Section Manager", "ホームセクション管理"],
      "new": ["新建分段", "New Section", "新規セクション"],
      "empty": ["暂无分段，点击\"新建分段\"开始创建。", "No sections yet. Click 'New Section' to create one.", "セクションがありません。「新規セクション」をクリックして作成してください。"],
      "card": {
        "sort": ["排序", "Sort", "順序"],
        "buttons": ["按钮数", "Buttons", "ボタン数"],
        "updated": ["更新时间", "Updated", "更新日時"],
        "bgSet": ["✓ 已设置背景图", "✓ Background Set", "✓ 背景設定済み"],
        "unnamed": ["未命名", "Unnamed", "名称未設定"]
      },
      "actions": {
        "up": ["上移", "Move Up", "上へ"],
        "down": ["下移", "Move Down", "下へ"],
        "edit": ["编辑", "Edit", "編集"],
        "delete": ["删除", "Delete", "削除"],
        "confirm": ["确认", "Confirm", "確認"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "delete": {
        "title": ["确认删除分段", "Confirm Delete Section", "セクション削除の確認"],
        "desc": ["删除后该分段将不会在首页展示，且不可恢复。", "This section will be removed from the homepage and cannot be restored.", "削除したセクションはホームページに表示されず、元に戻せません。"]
      },
      "toast": {
        "deleteSuccess": ["分段已删除。", "Section deleted.", "セクションが削除されました。"],
        "deleteError": ["删除分段失败，请稍后重试。", "Failed to delete section.", "セクションの削除に失敗しました。"],
        "orderSuccess": ["排序已更新。", "Order updated.", "順序が更新されました。"],
        "orderError": ["更新排序失败，请稍后重试。", "Failed to update order.", "順序の更新に失敗しました。"],
        "fetchError": ["获取分段列表失败，请稍后重试。", "Failed to fetch sections.", "セクションリストの取得に失敗しました。"]
      }
    },
    "posts": {
      "title": ["文章管理", "Posts Management", "記事管理"],
      "subtitle": ["管理公告、文档及更新日志内容。", "Manage announcements, documents, and changelogs.", "お知らせ、ドキュメント、更新履歴を管理します。"],
      "searchPlaceholder": ["搜索标题、分类或 slug...", "Search title, category or slug...", "タイトル、カテゴリ、slugで検索..."],
      "new": ["新建文章", "New Post", "新規記事"],
      "loading": ["加载中…", "Loading…", "読み込み中…"],
      "empty": ["当前还没有文章", "No posts yet", "記事はまだありません"],
      "emptyDesc": ["点击下面的按钮开始创建你的第一篇文章。", "Click the button below to create your first post.", "下のボタンをクリックして最初の記事を作成してください。"],
      "noResults": ["没有符合搜索条件的文章", "No posts found", "該当する記事が見つかりません"],
      "noResultsDesc": ["尝试调整关键词或清空搜索条件。", "Try adjusting keywords or clearing search filters.", "キーワードを調整するか、検索条件をクリアしてください。"],
      "categories": {
        "announcement": ["公告", "Announcement", "お知らせ"],
        "docs": ["文档", "Docs", "ドキュメント"],
        "changelog": ["更新日志", "Changelog", "更新履歴"]
      },
      "uncategorized": ["未分类", "Uncategorized", "未分類"],
      "status": {
        "published": ["已发布", "Published", "公開済み"],
        "draft": ["草稿", "Draft", "下書き"]
      },
      "lastUpdated": ["最后更新：", "Last Updated: ", "最終更新："],
      "delete": {
        "title": ["确认删除文章", "Confirm Delete Post", "記事の削除確認"],
        "desc": ["删除后该文章将无法恢复，且对应内容将不再对前台展示。确认要继续吗？", "Deleted posts cannot be recovered and will no longer be visible. Continue?", "削除された記事は復元できず、表示されなくなります。続行しますか？"],
        "confirm": ["确认删除", "Confirm Delete", "削除確認"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "toast": {
        "fetchError": ["获取文章列表失败，请稍后重试。", "Failed to fetch posts. Please retry later.", "記事リストの取得に失敗しました。後で再試行してください。"],
        "deleteSuccess": ["文章已删除。", "Post deleted.", "記事が削除されました。"],
        "deleteError": ["删除文章失败，请稍后重试。", "Failed to delete post. Please retry later.", "記事の削除に失敗しました。後で再試行してください。"]
      }
    },
    "postEditor": {
      "createTitle": ["新建文章", "New Post", "新規記事"],
      "editTitle": ["编辑文章", "Edit Post", "記事編集"],
      "translate": ["一键翻译", "Auto Translate", "自動翻訳"],
      "translating": ["翻译中...", "Translating...", "翻訳中..."],
      "save": ["保存", "Save", "保存"],
      "saving": ["保存中...", "Saving...", "保存中..."],
      "basicInfo": ["基本信息", "Basic Info", "基本情報"],
      "titleLabel": ["标题 *", "Title *", "タイトル *"],
      "titlePlaceholder": ["输入文章标题", "Enter post title", "タイトルを入力"],
      "summaryLabel": ["摘要", "Summary", "概要"],
      "summaryPlaceholder": ["输入文章摘要（可选）...", "Enter summary (optional)...", "概要を入力（オプション）..."],
      "coverLabel": ["封面图片", "Cover Image", "カバー画像"],
      "pinned": ["置顶文章", "Pinned Post", "固定記事"],
      "pinnedDesc": ["文章将显示在列表顶部", "Post will appear at the top", "リストの上部に表示されます"],
      "unpinnedDesc": ["文章按时间顺序显示", "Ordered by date", "日付順に表示されます"],
      "categoryLabel": ["分类", "Category", "カテゴリ"],
      "publicStatus": ["发布状态", "Visibility", "公開ステータス"],
      "public": ["已发布", "Published", "公開"],
      "draft": ["草稿", "Draft", "下書き"],
      "publicHint": ["文章将对所有访客可见", "Visible to all visitors", "すべての訪問者に表示されます"],
      "draftHint": ["仅在后台可见，不对外公开", "Visible only in admin panel", "管理画面でのみ表示されます"],
      "contentLabel": ["内容（富文本）*", "Content (Rich Text) *", "本文 (リッチテキスト) *"],
      "contentPlaceholder": ["在此输入内容...", "Type content here...", "ここに内容を入力..."],
      "editorLoading": ["加载编辑器中...", "Loading editor...", "エディターを読み込み中..."],
      "imageUploadError": ["图片上传失败，请重试", "Image upload failed, please retry", "画像のアップロードに失敗しました。再試行してください"],
      "slugLabel": ["URL 标识 (Slug)", "URL Slug", "URLスラグ"],
      "slugHint": ["用于生成文章 URL，留空将自动根据中文标题生成。", "Used for URL. Leave empty to auto-generate from title.", "URLに使用されます。空欄の場合、自動生成されます。"],
      "toast": {
        "connectTranslate": ["正在连接翻译服务...", "Connecting to translation service...", "翻訳サービスに接続中..."],
        "noContent": ["未检测到需要翻译的内容，请先填写至少一个语言的字段。", "No content to translate. Fill at least one language.", "翻訳するコンテンツがありません。少なくとも1つの言語を入力してください。"],
        "translateSuccess": ["翻译完成！", "Translation completed!", "翻訳完了！"],
        "translateError": ["翻译失败，请稍后重试。", "Translation failed. Please retry later.", "翻訳に失敗しました。後で再試行してください。"],
        "createSuccess": ["文章已创建", "Post created", "記事が作成されました"],
        "updateSuccess": ["文章已更新", "Post updated", "記事が更新されました"],
        "saveError": ["保存失败，请检查表单或稍后再试。", "Save failed. Check form or retry.", "保存に失敗しました。フォームを確認するか、後で再試行してください。"],
        "loadError": ["加载文章失败，请重试", "Failed to load post. Please retry.", "記事の読み込みに失敗しました。再試行してください。"]
      }
    },
    "media": {
      "title": ["资源库", "Media Library", "メディアライブラリ"],
      "subtitle": ["管理所有上传的图片、视频和其他文件", "Manage all uploaded images, videos, and files", "アップロードされた画像、動画、ファイルを管理します"],
      "manager": {
        "searchPlaceholder": ["搜索文件…", "Search files…", "ファイルを検索…"],
        "tabs": {
          "all": ["全部", "All", "すべて"],
          "images": ["图片", "Images", "画像"],
          "videos": ["视频", "Videos", "動画"],
          "files": ["其他", "Other", "その他"]
        },
        "upload": ["上传文件", "Upload File", "ファイルをアップロード"],
        "uploading": ["上传中…", "Uploading…", "アップロード中…"],
        "empty": {
          "noResults": ["没有找到符合条件的文件", "No matching files found", "条件に一致するファイルが見つかりません"],
          "default": ["还没有上传任何文件", "No files uploaded yet", "まだファイルがアップロードされていません"]
        },
        "delete": {
          "title": ["确认删除", "Confirm Delete", "削除確認"],
          "desc": ["确定要删除这个文件吗？此操作不可恢复。", "Are you sure you want to delete this file? This action cannot be undone.", "このファイルを削除してもよろしいですか？この操作は元に戻せません。"],
          "confirm": ["删除", "Delete", "削除"],
          "cancel": ["取消", "Cancel", "キャンセル"]
        },
        "details": {
          "title": ["文件详情", "File Details", "ファイル詳細"],
          "fileName": ["文件名：", "File Name:", "ファイル名："],
          "uploadedAt": ["上传时间：", "Uploaded At:", "アップロード日時："],
          "fileUrl": ["文件 URL：", "File URL:", "ファイル URL："],
          "unknown": ["未知", "Unknown", "不明"]
        },
        "actions": {
          "copyUrl": ["复制 URL", "Copy URL", "URL をコピー"],
          "deleteFile": ["删除文件", "Delete File", "ファイルを削除"]
        },
        "toast": {
          "fetchError": ["获取媒体列表失败，请重试", "Failed to fetch media list. Please retry.", "メディア一覧の取得に失敗しました。再試行してください。"],
          "uploadError": ["上传失败，请重试", "Upload failed. Please retry.", "アップロードに失敗しました。再試行してください。"],
          "deleteError": ["删除失败，请重试", "Delete failed. Please retry.", "削除に失敗しました。再試行してください。"],
          "copySuccess": ["URL 已复制到剪贴板", "URL copied to clipboard.", "URL をクリップボードにコピーしました。"],
          "copyError": ["复制失败，请手动复制", "Copy failed. Please copy manually.", "コピーに失敗しました。手動でコピーしてください。"]
        }
      }
    },
    "announcements": {
      "title": ["公告管理", "Announcements", "お知らせ管理"],
      "subtitle": ["管理站点顶部的全局横幅公告，支持多语言与时间范围。", "Manage global banner announcements at the top of the site.", "サイト上部のグローバルバナーお知らせを管理します。"],
      "new": ["新建公告", "New Announcement", "新規お知らせ"],
      "loading": ["加载中…", "Loading…", "読み込み中…"],
      "empty": ["暂无公告", "No announcements yet", "お知らせはありません"],
      "emptyDesc": ["创建公告以在网站顶部显示横幅", "Create announcements to display banners at the top of the site", "お知らせを作成してサイト上部にバナーを表示します"],
      "table": {
        "content": ["内容预览", "Content Preview", "内容プレビュー"],
        "noContent": ["暂无内容", "No content", "内容なし"],
        "link": ["链接", "Link", "リンク"],
        "time": ["时间范围", "Time Range", "期間"],
        "status": ["状态", "Status", "ステータス"],
        "actions": ["操作", "Actions", "操作"]
      },
      "status": {
        "active": ["已启用", "Active", "有効"],
        "disabled": ["已禁用", "Disabled", "無効"]
      },
      "delete": {
        "title": ["确认删除", "Confirm Delete", "削除確認"],
        "desc": ["您确定要删除这个公告吗？此操作不可撤销。", "Are you sure you want to delete this announcement? This action cannot be undone.", "このお知らせを削除してもよろしいですか？この操作は取り消せません。"],
        "confirm": ["确认删除", "Confirm Delete", "削除確認"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "form": {
        "createTitle": ["新建公告", "New Announcement", "新規お知らせ"],
        "editTitle": ["编辑公告", "Edit Announcement", "お知らせ編集"],
        "contentLabel": ["多语言内容 *", "Multilingual Content *", "多言語コンテンツ *"],
        "translate": ["一键翻译", "Auto Translate", "自動翻訳"],
        "translating": ["翻译中...", "Translating...", "翻訳中..."],
        "zh": ["中文内容 (ZH) *", "Chinese Content (ZH) *", "中国語内容 (ZH) *"],
        "zhPlaceholder": ["输入中文公告内容…", "Enter Chinese announcement content…", "中国語のお知らせ内容を入力…"],
        "en": ["英文内容 (EN)", "English Content (EN)", "英語内容 (EN)"],
        "enPlaceholder": ["Enter English announcement content…", "Enter English announcement content…", "英語のお知らせ内容を入力…"],
        "ja": ["日文内容 (JA)", "Japanese Content (JA)", "日本語内容 (JA)"],
        "jaPlaceholder": ["日本語のアナウンス内容を入力…", "Enter Japanese announcement content…", "日本語のアナウンス内容を入力…"],
        "link": ["跳转链接（可选）", "Link (Optional)", "リンク（任意）"],
        "linkPlaceholder": "https://example.com",
        "type": ["公告类型", "Type", "タイプ"],
        "typeInfo": ["普通 (蓝色)", "Info (Blue)", "情報 (青)"],
        "typeUrgent": ["紧急 (红色)", "Urgent (Red)", "緊急 (赤)"],
        "startTime": ["开始时间（可选）", "Start Time (Optional)", "開始日時（任意）"],
        "endTime": ["结束时间（可选）", "End Time (Optional)", "終了日時（任意）"],
        "preview": ["预览", "Preview", "プレビュー"],
        "previewEmpty": ["（暂无预览内容）", "(No preview content)", "（プレビュー内容がありません）"],
        "details": ["(查看详情) →", "(View Details) →", "(詳細を見る) →"],
        "active": ["启用此公告", "Enable Announcement", "このお知らせを有効にする"],
        "cancel": ["取消", "Cancel", "キャンセル"],
        "update": ["更新", "Update", "更新"],
        "create": ["创建", "Create", "作成"]
      },
      "toast": {
        "updateSuccess": ["公告已更新。", "Announcement updated.", "お知らせが更新されました。"],
        "createSuccess": ["公告已创建。", "Announcement created.", "お知らせが作成されました。"],
        "deleteSuccess": ["公告已删除。", "Announcement deleted.", "お知らせが削除されました。"],
        "deleteError": ["删除失败，请重试。", "Delete failed, please retry.", "削除に失敗しました。"],
        "noContent": ["没有可翻译内容，请先填写任一语言。", "No content to translate. Fill at least one language.", "翻訳対象の内容がありません。いずれかの言語を入力してください。"],
        "translateSuccess": ["翻译完成！", "Translation completed!", "翻訳が完了しました！"],
        "translateError": ["翻译失败，请稍后重试。", "Translation failed. Please retry later.", "翻訳に失敗しました。後で再試行してください。"]
      }
    },
    "serverMaps": {
      "title": ["服务器地图管理", "Server Maps", "サーバーマップ管理"],
      "subtitle": ["管理服务器地图的外部链接", "Manage external links for server maps", "サーバーマップの外部リンクを管理します"],
      "new": ["新建地图", "New Map", "新規マップ"],
      "empty": ["当前还没有地图", "No maps yet", "マップはまだありません"],
      "emptyDesc": ["点击上面的按钮开始创建", "Click the button above to create one", "上のボタンをクリックして作成してください"],
      "sort": ["排序", "Sort", "順序"],
      "loading": ["加载中...", "Loading...", "読み込み中..."],
      "validation": {
        "invalidUrl": ["地图地址格式不正确，请使用 http(s)://host:port/path", "Invalid map URL. Use http(s)://host:port/path", "マップURLの形式が正しくありません。http(s)://host:port/path を使用してください"]
      },
      "form": {
        "createTitle": ["新建地图", "New Map", "新規マップ"],
        "editTitle": ["编辑地图", "Edit Map", "マップ編集"],
        "name": ["地图名称 *", "Map Name *", "マップ名 *"],
        "url": ["地图 URL *", "Map URL *", "マップ URL *"],
        "sort": ["排序顺序", "Sort Order", "表示順"],
        "namePlaceholder": ["例如：主世界地图", "Example: Overworld Map", "例：メインワールドマップ"],
        "urlPlaceholder": ["http://127.0.0.1:8123/map (支持非标端口)", "http://127.0.0.1:8123/map (custom port supported)", "http://127.0.0.1:8123/map（カスタムポート対応）"],
        "urlHint": ["支持 `http://` / `https://`，并支持自定义端口（如 `:8123`）。", "Supports `http://` / `https://` and custom ports such as `:8123`.", "`http://` / `https://` と、`:8123` のようなカスタムポートをサポートします。"],
        "sortPlaceholder": "0",
        "save": ["保存", "Save", "保存"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "delete": {
        "title": ["确认删除", "Confirm Delete", "削除確認"],
        "confirmHint": ["确认删除地图「{{name}}」吗？此操作不可撤销。", "Delete map \"{{name}}\"? This action cannot be undone.", "マップ「{{name}}」を削除しますか？この操作は取り消せません。"],
        "confirm": ["确认", "Confirm", "確認"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "toast": {
        "updateSuccess": ["地图已更新", "Map updated", "マップが更新されました"],
        "createSuccess": ["地图已创建", "Map created", "マップが作成されました"],
        "deleteSuccess": ["地图已删除", "Map deleted", "マップが削除されました"],
        "saveError": ["保存失败，请稍后重试。", "Save failed, please retry later.", "保存に失敗しました。後で再試行してください。"]
      }
    },
    "serverInfoFields": {
      "title": ["服务器信息字段管理", "Server Info Fields", "サーバー情報フィールド管理"],
      "subtitle": ["管理服务器信息页面的动态字段", "Manage dynamic fields for the server info page", "サーバー情報ページの動的フィールドを管理します"],
      "new": ["新建字段", "New Field", "新規フィールド"],
      "empty": ["当前还没有字段", "No fields yet", "フィールドはまだありません"],
      "emptyDesc": ["点击上面的按钮开始创建", "Click the button above to create one", "上のボタンをクリックして作成してください"],
      "unnamed": ["未命名", "Unnamed", "名称未設定"],
      "icon": ["图标", "Icon", "アイコン"],
      "sort": ["排序", "Sort", "順序"],
      "form": {
        "createTitle": ["新建字段", "New Field", "新規フィールド"],
        "editTitle": ["编辑字段", "Edit Field", "フィールド編集"],
        "icon": ["图标名称 *", "Icon Name *", "アイコン名 *"],
        "iconHint": ["选择 Lucide React 图标名称", "Select Lucide React icon name", "Lucide React アイコン名を選択"],
        "label": ["标签（多语言） *", "Label (Multilingual) *", "ラベル（多言語） *"],
        "value": ["显示值（多语言） *", "Value (Multilingual) *", "表示値（多言語） *"],
        "translate": ["一键智能翻译", "Auto Translate", "自動翻訳"],
        "translating": ["正在翻译...", "Translating...", "翻訳中..."],
        "sort": ["排序顺序", "Sort Order", "表示順"],
        "save": ["保存", "Save", "保存"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "delete": {
        "title": ["确认删除字段", "Confirm Deletion", "フィールド削除の確認"],
        "desc": ["删除后该字段将不再展示在公开页面，且不可恢复。", "This field will be removed from the public page and cannot be restored.", "削除したフィールドは公開ページに表示されず、元に戻せません。"],
        "deleting": ["删除中...", "Deleting...", "削除中..."],
        "confirm": ["确认", "Confirm", "確認"],
        "cancel": ["取消", "Cancel", "キャンセル"]
      },
      "toast": {
        "updateSuccess": ["字段已更新", "Field updated", "フィールドが更新されました"],
        "createSuccess": ["字段已创建", "Field created", "フィールドが作成されました"],
        "deleteSuccess": ["字段已删除", "Field deleted", "フィールドが削除されました"],
        "translateSuccess": ["翻译完成", "Translation completed", "翻訳が完了しました"],
        "translateError": ["翻译失败", "Translation failed", "翻訳に失敗しました"],
        "noContent": ["未检测到需要翻译的内容", "No translatable content detected", "翻訳する内容がありません"],
        "saveError": ["保存失败，请稍后重试。", "Save failed, please retry later.", "保存に失敗しました。後で再試行してください。"]
      }
    },
    "velocity": {
      "title": ["Velocity 管理", "Velocity Manager", "Velocity 管理"],
      "subtitle": ["管理您的本地 Minecraft 代理服务器", "Manage your local Minecraft proxy server", "ローカル Minecraft プロキシサーバーを管理"],
      "refresh": ["刷新", "Refresh", null],
      "restart": ["重启 Velocity", "Restart Proxy", "再起動"],
      "restarting": ["正在重启...", "Triggering...", "送信中..."],
      "restartSuccess": ["已触发重启", "Restart trigger sent", "再起動コマンドを送信しました"],
      "testConnection": ["测试连接", "Test Conn", "接続テスト"],
      "testing": ["测试中...", "Testing...", "テスト中..."],
      "tabs": {
        "dashboard": ["仪表盘", "Dashboard", "ダッシュボード"],
        "servers": ["服务器列表", "Servers", "サーバーリスト"],
        "settings": ["全局设置", "Settings", "全体設定"],
        "update": ["核心更新", "Update", "コア更新"],
        "forcedHosts": ["域名映射", "Forced Hosts", "強制ホスト"]
      },
      "forcedHosts": {
        "hostname": ["域名 (Hostname)", "Hostname", "ホスト名 (Hostname)"],
        "server": ["目标服务器", "Target Server", "ターゲットサーバー"],
        "selectServer": ["选择服务器...", "Select Server...", "サーバーを選択..."],
        "empty": ["暂无域名映射配置。", "No forced hosts configured.", "強制ホスト設定はありません。"],
        "table": {
          "hostname": ["域名", "Hostname", "ホスト名"],
          "server": ["目标", "Target", "ターゲット"],
          "empty": ["无配置", "No Config", "設定なし"]
        }
      },
      "dashboard": {
        "status": ["状态", "Status", "ステータス"],
        "statusActive": ["配置已激活", "Config Active", "設定適用済み"],
        "syncStatus": ["上次同步", "Last sync", "前回の同期"],
        "lastSuccess": ["上次同步成功", "Last sync succeeded", "前回の同期は成功"],
        "lastFailure": ["上次同步失败", "Last sync failed", "前回の同期は失敗"],
        "pending": ["等待同步", "Sync pending", "同期待ち"],
        "unknown": ["同步状态未知", "Sync unknown", "同期状態不明"],
        "statusDesc": ["通过同步脚本管理", "Managed via sync script", "同期スクリプト経由"],
        "proxyStatus": ["代理进程", "Proxy Process", "プロキシプロセス"],
        "proxyStatusDesc": ["实时进程状态", "Real-time process status", "リアルタイム状態"],
        "servers": ["服务器", "Servers", "サーバー"],
        "serversDesc": ["已配置后端服务器", "Configured backend servers", "設定済みサーバー"],
        "port": ["端口", "Port", "ポート"],
        "portDesc": ["监听端口", "Listening port", "リッスンポート"],
        "nextSteps": ["下一步", "Next Steps", "次のステップ"],
        "step1": ["确保同步脚本在服务器上运行。", "Ensure sync script is running on the server.", "同期スクリプトがサーバー上で実行されていることを確認してください。"],
        "step2": ["在“服务器列表”或“全局设置”选项卡中进行更改。", "Make changes in 'Servers' or 'Settings' tabs.", "「サーバーリスト」または「全体設定」タブで変更を行います。"],
        "step3": ["脚本将自动检测更改并重启 Velocity。", "Script will auto-detect changes and restart Velocity.", "スクリプトは変更を自動的に検出し、Velocity を再起動します。"]
      },
      "servers": {
        "name": ["服务器名称", "Server Name", "サーバー名"],
        "address": ["地址 (IP:Port)", "Address (IP:Port)", "アドレス (IP:Port)"],
        "order": ["顺序", "Order", "順序"],
        "tryFirst": ["优先尝试", "Try First", "優先接続"],
        "add": ["添加", "Add", "追加"],
        "table": {
          "order": ["顺序", null, "順序"],
          "name": ["名称", "Name", "名前"],
          "address": ["地址", "Address", "アドレス"],
          "tryFirst": ["优先", null, "優先"],
          "actions": ["操作", "Actions", "操作"],
          "yes": ["是", "Yes", "はい"],
          "no": ["否", "No", "いいえ"],
          "empty": ["暂无服务器配置。", "No servers configured yet.", "サーバーはまだ設定されていません。"],
          "confirmDelete": ["确定要删除此服务器吗？", "Are you sure you want to delete this server?", "このサーバーを削除してもよろしいですか？"],
          "tryOrder": [null, "Order", null],
          "isTry": [null, "Try Server", null],
          "status": [null, "Status", null]
        }
      },
      "settings": {
        "bindPort": ["绑定端口", "Bind Port", "バインドポート"],
        "defaultPort": ["默认: 25577", "Default: 25577", "デフォルト: 25577"],
        "maxPlayers": ["最大玩家数", "Max Players", "最大プレイヤー数"],
        "motd": ["服务器标语 (MOTD)", "Server MOTD", "サーバーメッセージ (MOTD)"],
        "motdHint": ["支持 Minecraft 颜色代码 (&a, &b...)", "Supports Minecraft Color Codes (&a, &b...)", "Minecraft カラーコード (&a, &b...) に対応"],
        "secret": ["转发密钥 (Forwarding Secret)", "Forwarding Secret", "転送シークレット (Forwarding Secret)"],
        "secretHint": ["必须与后端服务器 paper.yml 中的密钥匹配", "Must match secret in backend servers' paper.yml", "バックエンドサーバーの paper.yml 内のシークレットと一致する必要があります"],
        "advanced": ["高级设置", "Advanced Settings", "詳細設定"],
        "onlineMode": ["在线模式 (Online Mode)", "Online Mode", "Online Mode (正版認証)"],
        "onlineModeHint": ["是否开启正版验证 (建议 false)", "Enable Mojang authentication (disable for offline mode)", "Mojang認証を有効化 (オフラインモード時は無効)"],
        "forwardingMode": ["转发模式 (Forwarding Mode)", "Forwarding Mode", "Forwarding Mode (転送モード)"],
        "forceKey": ["强制密钥验证 (Force Key Auth)", "Force Key Authentication", "Force Key Authentication"],
        "forceKeyHint": ["推荐开启以增强安全性", "Enforce 1.19+ key signing", "1.19+ 署名検証を強制"],
        "preventProxy": ["防止客户端代理 (Prevent Proxy)", "Prevent Client Proxy", "Prevent Client Proxy"],
        "preventProxyHint": ["防止玩家使用代理连接", "Block client-side proxies", "クライアントプロキシをブロック"],
        "kickExisting": ["踢出已登录玩家", "Kick Existing Players", "Kick Existing Players"],
        "kickExistingHint": ["检测到重复登录时踢出旧连接", "Kick players if already logged in", "重複ログイン時に既存プレイヤーをキック"],
        "pingPassthrough": ["Ping 透传模式", "Ping Passthrough", "Ping Passthrough"],
        "pingPassthroughHint": ["控制代理返回给客户端的 Ping 信息来源", "Forward ping requests to backend", "Pingリクエストをバックエンドへ転送"],
        "samplePlayersInPing": ["在 Ping 中显示示例玩家", "Sample Players In Ping", "Ping にサンプルプレイヤーを表示"],
        "enablePlayerAddressLogging": ["记录玩家 IP 地址", "Enable Player Address Logging", "プレイヤーIPアドレスを記録"],
        "save": ["保存设置", "Save Settings", "設定を保存"],
        "saving": ["保存中...", "Saving...", "保存中..."],
        "success": ["设置保存成功！", "Settings saved successfully!", null],
        "error": ["保存设置失败。", "Failed to save settings.", null],
        "forwardingModeOptions": [{"modern":"モダン (Modern) - 推奨 1.13+","legacy":"レガシー (Legacy) - 1.12 以下","bungeeguard":"BungeeGuard - プラグインが必要","none":"なし (None) - 非推奨"}, {"modern":"Modern (Recommended for 1.13+)","legacy":"Legacy (BungeeCord 1.8-1.12)","bungeeguard":"BungeeGuard","none":"None"}, null],
        "haproxyProtocol": ["HAProxy 协议", "HAProxy Protocol", "HAProxy プロトコル"],
        "haproxyProtocolHint": ["通常用于配合 Spectrum 或 Nginx Stream", "For use with Spectrum / Nginx Stream", "Spectrum / Nginx Stream と併用"],
        "acceptsTransfers": ["接受跨服传送 (1.20.5+)", "Accept Transfers (1.20.5+)", "転送を受け入れる (1.20.5+)"],
        "acceptsTransfersHint": ["允许从其他代理传送玩家过来", "Allow players transferred from other proxies", "他のプロキシからのプレイヤー転送を許可"],
        "announceForge": ["Forge 支持", "Announce Forge", "Forge アナウンス"],
        "announceForgeHint": ["显示 Mod 列表给客户端 (FML)", "Show mod list to clients (FML)", "Modリストをクライアントに表示 (FML)"],
        "showPingRequests": ["显示 Ping 请求", "Show Ping Requests", "Pingリクエストを表示"],
        "showPingRequestsHint": ["在控制台显示 Ping 日志", "Log ping requests to console", "コンソールにPingログを表示"],
        "failoverOnUnexpectedDisconnect": ["后端异常断开时自动故障转移", "Failover On Unexpected Disconnect", "サーバー異常切断時にフェイルオーバー"],
        "logCommandExecutions": ["记录命令执行", "Log Command Executions", "コマンド実行を記録"],
        "logPlayerConnections": ["记录玩家连接/断开", "Log Player Connections", "プレイヤー接続ログを記録"],
        "enableReusePort": ["启用端口复用 (SO_REUSEPORT)", "Enable Reuse Port (SO_REUSEPORT)", "ポート再利用を有効化 (SO_REUSEPORT)"],
        "connectionTimeout": ["连接超时 (ms)", "Connection Timeout (ms)", "接続タイムアウト (ms)"],
        "connectionTimeoutHint": ["默认 5000ms", "Default 5000ms", "デフォルト 5000ms"],
        "readTimeout": ["读取超时 (ms)", "Read Timeout (ms)", "読み取りタイムアウト (ms)"],
        "readTimeoutHint": ["默认 30000ms", "Default 30000ms", "デフォルト 30000ms"],
        "compressionThreshold": ["压缩阈值 (Compression Threshold)", null, "圧縮しきい値 (Compression Threshold)"],
        "compressionThresholdHint": ["缺省 256. -1 禁用.", null, "デフォルト 256. -1 で無効."],
        "compressionLevel": ["压缩等级 (Compression Level)", null, "圧縮レベル (Compression Level)"],
        "compressionLevelHint": ["-1 (默认) ~ 9.", null, "-1 (デフォルト) ~ 9."],
        "loginRatelimit": ["登录限流 (ms)", null, "ログインレート制限 (ms)"],
        "loginRatelimitHint": ["两次登录间隔, 默认 3000ms", null, "ログイン間隔, デフォルト 3000ms"],
        "bungeePluginChannel": ["BungeeCord 插件消息", null, "BungeeCord プラグインメッセージ"],
        "bungeePluginChannelHint": ["是否启用 BungeeCord 消息通道", null, "BungeeCord メッセージチャンネルを有効化"],
        "tcpFastOpen": ["TCP Fast Open", null, "TCP Fast Open"],
        "tcpFastOpenHint": ["Linux 特性, 需内核支持", null, "Linux 機能, カーネルサポートが必要"],
        "exposeProxyCommands": ["公开代理命令 (Expose Proxy Commands)", "Expose Proxy Commands", "プロキシコマンドの公開"],
        "exposeProxyCommandsHint": ["允许在后端服务器使用代理命令", "Allow using proxy commands on backend servers", "バックエンドサーバーでプロキシコマンドを使用許可"],
        "query": ["Query 查询 (GameSpy 4)", "Query (GameSpy 4)", "クエリ (GameSpy 4)"],
        "queryEnabled": ["启用 Query", "Enable Query", "クエリを有効化"],
        "queryEnabledHint": ["允许外部查询服务器状态", "Allow external status queries", "外部からのステータス確認を許可"],
        "queryPort": ["查询端口", "Query Port", "クエリポート"],
        "queryMap": ["默认地图名称", "Default Map Name", "デフォルトマップ名"],
        "queryShowPlugins": ["显示插件列表", "Show Plugins", "プラグイン一覧を表示"],
        "rateLimit": ["命令/补全限流", "Command/Tab Rate Limits", "コマンド/補完レート制限"],
        "commandRateLimit": ["命令限流 (ms)", "Command Rate Limit (ms)", "コマンド制限間隔 (ms)"],
        "kickAfterRateLimitedCommands": ["命令限流后踢出阈值", "Kick After Rate-Limited Commands", "制限超過コマンドでキックする回数"],
        "tabCompleteRateLimit": ["补全限流 (ms)", "Tab Complete Rate Limit (ms)", "補完制限間隔 (ms)"],
        "kickAfterRateLimitedTabCompletes": ["补全限流后踢出阈值", "Kick After Rate-Limited Tab Completes", "制限超過補完でキックする回数"],
        "forwardCommandsIfRateLimited": ["命令被限流时转发到后端", "Forward Commands If Rate-Limited", "制限時はバックエンドへコマンド転送"],
        "forwardingSecret": [null, "Forwarding Secret", "Forwarding Secret"],
        "forwardingSecretHint": [null, "Must match backend server configuration", "バックエンドサーバー設定と一致させる必要があります"]
      },
      "modal": [{"addTitle":"添加服务器","editTitle":"编辑服务器","save":"保存","cancel":"取消","deleteTitle":"删除服务器","deleteConfirm":"确定要删除此服务器吗？此操作不可撤销。","name":"服务器名称","address":"地址 (IP:端口)","tryOrder":"尝试顺序 (越小越优先)","isTry":"是否作为登录服 (Try Server)","namePlaceholder":"例如：Lobby","addressPlaceholder":"例如：127.0.0.1:25565"}, {"addTitle":"Add Server","editTitle":"Edit Server","save":"Save","cancel":"Cancel","deleteTitle":"Delete Server","deleteConfirm":"Are you sure you want to delete this server? This action cannot be undone.","name":"Server Name","address":"Address (IP:Port)","tryOrder":"Try Order (Lower is first)","isTry":"Use as Try Server","namePlaceholder":"e.g. Lobby","addressPlaceholder":"e.g. 127.0.0.1:25565"}, null],
      "update": [{"warningTitle":"核心升级警告","warningDesc":"上传新的 JAR 文件将在下一次同步周期触发服务器重启。请确保 JAR 文件与您的配置兼容。","currentVersion":"当前版本","customJar":"已上传自定义 JAR","defaultJar":"默认 / 未设置","versionLabel":"版本标识","uploadTitle":"上传新核心","clickToUpload":"点击上传 velocity.jar","maxSize":"最大文件大小: 100MB","uploading":"上传中...","success":"Velocity JAR 上传成功！服务器将在下次同步时自动更新。","error":"上传 JAR 文件失败。"}, {"warningTitle":"Core Upgrade Warning","warningDesc":"Uploading a new jar will trigger a server restart on the next sync cycle. Ensure the jar is compatible with your config.","currentVersion":"Current Version","customJar":"Custom JAR Uploaded","defaultJar":"Default / Not Set","versionLabel":"Version Label","uploadTitle":"Upload New Core","clickToUpload":"Click to upload velocity.jar","maxSize":"Max size: 100MB","uploading":"Uploading...","success":"Velocity JAR uploaded successfully! Server will auto-update on next sync.","error":"Failed to upload JAR file."}, null],
      "actions": [{"confirmRestart":"确认重启 Velocity 代理？","restartError":"触发重启失败。","addServerError":"添加服务器失败。","deleteServerError":"删除服务器失败。","confirmDelete":"确认删除此服务器吗？"}, {"confirmRestart":"Restart Velocity Proxy?","restartError":"Failed to trigger restart.","addServerError":"Error adding server.","deleteServerError":"Error deleting server.","confirmDelete":"Are you sure you want to delete this server?"}, null],
      "table": {
        "tryOrder": ["尝试顺序", "Order", "優先順位"],
        "name": ["名称", "Name", "名前"],
        "address": ["地址", "Address", "アドレス"],
        "isTry": ["是否尝试", "Try Server", "デフォルト"],
        "status": ["状态", "Status", "状態"],
        "actions": ["操作", "Actions", "操作"],
        "yes": ["是", null, null],
        "no": ["否", null, null],
        "ping": [null, "Ping", "Ping"]
      },
      "status": {
        "online": ["在线", "Online", "オンライン"],
        "offline": ["离线", "Offline", "オフライン"],
        "checking": ["检测中...", null, "確認中..."],
        "pending": [null, "Pending...", "確認中..."],
        "error": [null, "Error", "エラー"]
      },
      "loading": ["加载 Velocity 配置中...", "Loading Velocity Configuration...", null],
      "forwardingModeOptions": [{"modern":"Modern (推荐 1.13+)","legacy":"Legacy (BungeeCord 1.8-1.12)","bungeeguard":"BungeeGuard","none":"None"}, null, {"modern":"Modern (1.13+ 推奨)","legacy":"Legacy (BungeeCord 1.8-1.12)","bungeeguard":"BungeeGuard","none":"なし"}],
      "auditLogs": [null, {"title":"Audit Logs","subtitle":"View operation records of admins and SSO users","actions":{"all":"All Types","login":"Login","create":"Create","update":"Update","delete":"Delete","system":"System Settings","other":"Other"},"table":{"time":"Time","user":"User","type":"Type","module":"Module","details":"Details"},"empty":{"title":"No audit logs yet","desc":"Logs are automatically recorded when admins perform actions.","filteredTitle":"No logs found","filteredDesc":"Try adjusting filters or clearing them."},"pagination":{"prev":"Prev","next":"Next","info":"Page {{page}} / {{total}}"},"error":{"fetch":"Failed to fetch logs, please try again later."},"unknownUser":"Unknown User"}, null],
      "sectionEditor": [null, {"title":{"create":"New Section","edit":"Edit Section"},"buttons":{"translate":"Auto Translate","translating":"Connecting to translation service...","save":"Save","add":"Add Button","remove":"Remove","cancel":"Cancel"},"form":{"sort":"Sort Order","sortHint":"Smaller numbers appear first","title":"Title","subtitle":"Subtitle","content":"Content","announcement":"Announcement","background":"Background Image","buttons":"Buttons","buttonLabel":"Button Text","link":"Link","style":"Style"},"styles":{"primary":"Primary","secondary":"Secondary"},"placeholders":{"enter":"Enter {{lang}} {{field}}"},"toast":{"created":"Section created","updated":"Section updated","saved":"Saved!","translateSuccess":"Translation complete!","translateError":"Translation failed","noContent":"No content to translate","saveError":"Failed to save"},"emptyButtons":"No buttons yet. Click 'Add Button' to create one."}, null],
      "whitelist": [null, {"title":"SSO Whitelist","subtitle":"Manage email addresses allowed to login via SSO","loading":"Loading…","buttons":{"add":"Add Whitelist","edit":"Edit","delete":"Delete","cancel":"Cancel","confirmDelete":"Confirm Delete","retry":"Retry","close":"Close"},"table":{"email":"Email","desc":"Description","time":"Added At","actions":"Actions"},"form":{"email":"Email Address","emailPlaceholder":"user@example.com","desc":"Description","descPlaceholder":"Optional description","emailDisabled":"Email cannot be modified"},"empty":{"title":"No whitelist records","desc":"Add email addresses to allow SSO login."},"delete":{"title":"Confirm Delete","desc":"Are you sure you want to delete this whitelist record? The email will no longer be able to login via SSO."},"toast":{"added":"Whitelist added.","updated":"Whitelist updated.","deleted":"Whitelist removed: {{email}}","saveError":"Failed to save.","deleteError":"Failed to delete.","fetchError":"Failed to fetch whitelist."},"error":{"title":"Error","login":"User not logged in","permission":"Insufficient permissions","notFound":"Collection not found"}}, null],
      "imagePicker": [null, {"defaultLabel":"Image","preview":"Preview","uploadOrSelect":"Upload new image or select from library","uploading":"Uploading...","upload":"Upload Image","selectFromLib":"Select from Library","uploadError":"Upload failed","retry":"Please retry"}, null],
      "mediaLibraryModal": [null, {"title":"Select Image from Library","loading":"Loading…","search":"Search images...","noResults":"No matching images found","empty":"No images in media library","image":"Image","clickToSelect":"Click to Select","unknown":"Unknown","fetchError":"Failed to fetch media list"}, null],
      "menuBar": [null, {"bold":"Bold (Ctrl+B)","italic":"Italic (Ctrl+I)","sourceMode":"Source Mode (HTML)","wysiwygMode":"Rich Text Mode","sourceModeHint":"Source mode is enabled. You can paste HTML directly.","sourceModePlaceholder":"Paste or edit HTML source here...","heading1":"Heading 1","heading2":"Heading 2","heading3":"Heading 3","bulletList":"Bullet List","orderedList":"Ordered List","quote":"Quote","link":"Insert Link","uploadImage":"Upload Image","selectFromLibrary":"Select from Media Library","linkDialog":{"title":"Insert Link","label":"Link URL","placeholder":"https://example.com","cancel":"Cancel","confirm":"Confirm"}}, null],
      "mcsm": [null, {"title":"MCSM Panel Manager","subtitle":"Remotely manage MCSManager server instances","loading":"Loading MCSM data...","refresh":"Refresh","error":{"loadFailed":"Failed to load MCSM configuration"},"tabs":{"dashboard":"Dashboard","instances":"Instances","console":"Console","files":"Files","settings":"Settings"},"status":{"busy":"Busy","stopped":"Stopped","stopping":"Stopping","starting":"Starting","running":"Running"},"settings":{"panelUrl":"Panel URL","apiKey":"API Key","enabled":"Enable MCSM Integration","cacheTtl":"Public Cache TTL","instanceLabels":"Instance Labels","labelName":"Friendly Name","hiddenInstances":"Hidden Instances","hiddenDesc":"Hidden instances won't appear on the public server info page","save":"Save Settings","saveSuccess":"MCSM settings saved","saveError":"Failed to save settings","testConnection":"Test Connection","testSuccess":"Connection successful","testFailed":"Connection failed. Check panel URL and API Key."},"dashboard":{"loading":"Loading panel data...","version":"Panel Version","nodes":"Nodes","instances":"Instances (Running/Total)","system":"System Resources","nodeList":"Node List","online":"Online","offline":"Offline","instanceCount":"{{count}} instances"},"instances":{"title":"Instance List","empty":"No instances found","start":"Start","stop":"Stop","restart":"Restart","kill":"Kill","confirmKill":"Are you sure you want to force kill this instance? This may cause data loss.","actionSuccess":"Action {{action}} executed","actionError":"Action {{action}} failed","hide":"Hide","unhide":"Unhide","rename":"Rename","hidden":"Hidden","renamePrompt":"Enter new display name"},"console":{"selectInstance":"Select Instance","selectPlaceholder":"Select an instance...","noOutput":"No output log yet","commandPlaceholder":"Type a command and press Enter...","sendError":"Failed to send command"},"files":{"selectInstance":"Select Instance","listError":"Failed to list files","empty":"Directory is empty","newFolder":"New Folder","newFile":"New File","folderName":"Folder name","fileName":"File name","create":"Create","edit":"Edit","delete":"Delete","confirmDelete":"Are you sure you want to delete the selected files/folders?","save":"Save","cancel":"Cancel","saveSuccess":"File saved"}}, null],
      "guard": [null, {"verifying":"Verifying..."}, null],
      "success": [null, null, "設定が正常に保存されました！"],
      "error": [null, null, "設定の保存に失敗しました。"]
    },
    "auditLogs": [{"title":"操作日志","subtitle":"查看管理员和 SSO 用户的操作记录","actions":{"all":"全部类型","login":"登录","create":"创建","update":"更新","delete":"删除","system":"系统设置","other":"其他"},"table":{"time":"操作时间","user":"操作人","type":"操作类型","module":"目标模块","details":"详情"},"empty":{"title":"当前还没有操作日志","desc":"操作日志将在管理员执行操作时自动记录。","filteredTitle":"没有符合筛选条件的日志","filteredDesc":"尝试调整筛选条件或清空筛选。"},"pagination":{"prev":"上一页","next":"下一页","info":"第 {{page}} / {{total}} 页"},"error":{"fetch":"获取日志列表失败，请稍后重试"},"unknownUser":"未知用户"}, null, null],
    "sectionEditor": [{"title":{"create":"新建分段","edit":"编辑分段"},"buttons":{"translate":"一键翻译","translating":"正在连接翻译服务...","save":"保存","add":"添加按钮","remove":"移除","cancel":"取消"},"form":{"sort":"排序顺序","sortHint":"数字越小，显示越靠前","title":"标题","subtitle":"副标题","content":"内容","announcement":"公告","background":"背景图片","buttons":"按钮","buttonLabel":"按钮文字","link":"链接","style":"样式"},"styles":{"primary":"主要","secondary":"次要"},"placeholders":{"enter":"请输入{{lang}}{{field}}"},"toast":{"created":"分段已创建","updated":"分段已更新","saved":"保存成功！","translateSuccess":"翻译完成！","translateError":"翻译失败","noContent":"未检测到需要翻译的内容","saveError":"保存失败"},"emptyButtons":"暂无按钮，点击\"添加按钮\"创建"}, null, null],
    "whitelist": [{"title":"SSO 白名单管理","subtitle":"管理允许通过 SSO 登录的邮箱地址","loading":"加载中…","buttons":{"add":"添加白名单","edit":"编辑","delete":"删除","cancel":"取消","confirmDelete":"确认删除","retry":"重试","close":"关闭"},"table":{"email":"邮箱地址","desc":"备注","time":"添加时间","actions":"操作"},"form":{"email":"邮箱地址","emailPlaceholder":"user@example.com","desc":"备注","descPlaceholder":"可选备注信息","emailDisabled":"邮箱地址不可修改"},"empty":{"title":"暂无白名单记录","desc":"添加邮箱地址以允许通过 SSO 登录"},"delete":{"title":"确认删除","desc":"您确定要删除这个白名单记录吗？删除后该邮箱将无法通过 SSO 登录。"},"toast":{"added":"白名单已添加。","updated":"白名单已更新。","deleted":"移除了白名单：{{email}}","saveError":"保存失败。","deleteError":"删除失败。","fetchError":"获取白名单失败。"},"error":{"title":"错误","login":"用户未登录","permission":"权限不足","notFound":"Collection 不存在"}}, null, null],
    "imagePicker": [{"defaultLabel":"图片","preview":"预览","uploadOrSelect":"上传新图片或从媒体库选择","uploading":"上传中...","upload":"上传图片","selectFromLib":"从媒体库选择","uploadError":"上传失败","retry":"请重试"}, null, null],
    "mediaLibraryModal": [{"title":"从媒体库选择图片","loading":"加载中…","search":"搜索图片...","noResults":"没有找到符合条件的图片","empty":"媒体库中还没有图片","image":"图片","clickToSelect":"点击选择","unknown":"未知","fetchError":"获取媒体列表失败"}, null, null],
    "menuBar": [{"bold":"加粗 (Ctrl+B)","italic":"斜体 (Ctrl+I)","sourceMode":"源码模式 (HTML)","wysiwygMode":"富文本模式","sourceModeHint":"当前为源码模式，可直接粘贴 HTML。","sourceModePlaceholder":"在此粘贴或编辑 HTML 源码...","heading1":"标题 1","heading2":"标题 2","heading3":"标题 3","bulletList":"无序列表","orderedList":"有序列表","quote":"引用","link":"插入链接","uploadImage":"上传图片","selectFromLibrary":"从媒体库选择","linkDialog":{"title":"插入链接","label":"链接地址","placeholder":"https://example.com","cancel":"取消","confirm":"确认"}}, null, null],
    "mcsm": [{"title":"MCSM 面板管理","subtitle":"远程管理 MCSManager 服务器实例","loading":"加载 MCSM 数据中...","refresh":"刷新","error":{"loadFailed":"加载 MCSM 配置失败"},"tabs":{"dashboard":"仪表盘","instances":"实例管理","console":"控制台","files":"文件管理","settings":"连接设置"},"status":{"busy":"忙碌","stopped":"已停止","stopping":"停止中","starting":"启动中","running":"运行中"},"settings":{"panelUrl":"面板地址","apiKey":"API Key","enabled":"启用 MCSM 集成","cacheTtl":"公开缓存 TTL","instanceLabels":"实例友好名称","labelName":"友好名称","hiddenInstances":"隐藏实例","hiddenDesc":"被隐藏的实例不会在公开的服务器信息页面显示","save":"保存设置","saveSuccess":"MCSM 设置已保存","saveError":"保存设置失败","testConnection":"测试连接","testSuccess":"连接成功","testFailed":"连接失败，请检查面板地址和 API Key"},"dashboard":{"loading":"加载面板数据中...","version":"面板版本","nodes":"节点数","instances":"实例 (运行/总计)","system":"系统资源","nodeList":"节点列表","online":"在线","offline":"离线","instanceCount":"{{count}} 个实例"},"instances":{"title":"实例列表","empty":"暂无实例","start":"启动","stop":"停止","restart":"重启","kill":"强制终止","confirmKill":"确定要强制终止该实例吗？这可能导致数据丢失。","actionSuccess":"操作 {{action}} 已执行","actionError":"操作 {{action}} 失败","hide":"隐藏","unhide":"取消隐藏","rename":"重命名","hidden":"已隐藏","renamePrompt":"输入新的显示名称"},"console":{"selectInstance":"选择实例","selectPlaceholder":"请选择一个实例...","noOutput":"暂无输出日志","commandPlaceholder":"输入命令后按 Enter 发送...","sendError":"发送命令失败"},"files":{"selectInstance":"选择实例","listError":"获取文件列表失败","empty":"目录为空","newFolder":"新建文件夹","newFile":"新建文件","folderName":"文件夹名称","fileName":"文件名称","create":"创建","edit":"编辑","delete":"删除","confirmDelete":"确定要删除选中的文件/文件夹吗？","save":"保存","cancel":"取消","saveSuccess":"文件已保存"}}, null, null],
    "guard": [{"verifying":"验证中..."}, null, null],
    "modal": [null, null, {"addTitle":"サーバーを追加","editTitle":"サーバーを編集","save":"保存","cancel":"キャンセル","deleteTitle":"サーバーを削除","deleteConfirm":"本当にこのサーバーを削除しますか？この操作は取り消せません。","name":"サーバー名","address":"アドレス (IP:ポート)","tryOrder":"試行順序 (小さいほど優先)","isTry":"ログインサーバーとして使用 (Try Server)","namePlaceholder":"例：Lobby","addressPlaceholder":"例：127.0.0.1:25565"}],
    "update": [null, null, {"warningTitle":"コアアップグレード警告","warningDesc":"新しい JAR ファイルをアップロードすると、次回の同期サイクルでサーバーの再起動がトリガーされます。JAR ファイルが設定と互換性があることを確認してください。","currentVersion":"現在のバージョン","customJar":"カスタム JAR アップロード済み","defaultJar":"デフォルト / 未設定","versionLabel":"バージョンラベル","uploadTitle":"新コアアップロード","clickToUpload":"velocity.jar をアップロードするにはクリック","maxSize":"最大ファイルサイズ: 100MB","uploading":"アップロード中...","success":"Velocity JAR が正常にアップロードされました！次回の同期時にサーバーが自動更新されます。","error":"JAR ファイルのアップロードに失敗しました。"}],
    "actions": [null, null, {"confirmRestart":"Velocityプロキシを再起動しますか？","restartError":"再起動のトリガーに失敗しました。","addServerError":"サーバーの追加に失敗しました。","deleteServerError":"サーバーの削除に失敗しました。","confirmDelete":"このサーバーを削除してもよろしいですか？"}],
    "table": [null, null, {"tryOrder":"順序","name":"サーバー名","address":"アドレス","isTry":"優先サーバー","status":"ステータス","actions":"操作","yes":"はい","no":"いいえ"}],
    "loading": [null, null, "Velocity設定を読み込み中..."]
  },
  "auditLogs": [null, null, {"title":"操作ログ","subtitle":"管理者とSSOユーザーの操作履歴を表示","actions":{"all":"全タイプ","login":"ログイン","create":"作成","update":"更新","delete":"削除","system":"システム設定","other":"その他"},"table":{"time":"日時","user":"ユーザー","type":"タイプ","module":"モジュール","details":"詳細"},"empty":{"title":"操作ログはまだありません","desc":"管理者が操作を実行すると自動的に記録されます。","filteredTitle":"ログが見つかりません","filteredDesc":"フィルターを調整するか、クリアしてください。"},"pagination":{"prev":"前へ","next":"次へ","info":"{{page}} / {{total}} ページ"},"error":{"fetch":"ログの取得に失敗しました。後で再試行してください。"},"unknownUser":"不明なユーザー"}],
  "sectionEditor": [null, null, {"title":{"create":"新規セクション","edit":"セクション編集"},"buttons":{"translate":"自動翻訳","translating":"翻訳サービスに接続中...","save":"保存","add":"ボタン追加","remove":"削除","cancel":"キャンセル"},"form":{"sort":"並び順","sortHint":"数字が小さいほど先に表示されます","title":"タイトル","subtitle":"サブタイトル","content":"本文","announcement":"お知らせ","background":"背景画像","buttons":"ボタン","buttonLabel":"ボタンテキスト","link":"リンク","style":"スタイル"},"styles":{"primary":"プライマリ","secondary":"セカンダリ"},"placeholders":{"enter":"{{lang}}{{field}}を入力"},"toast":{"created":"セクションを作成しました","updated":"セクションを更新しました","saved":"保存しました！","translateSuccess":"翻訳完了！","translateError":"翻訳失敗","noContent":"翻訳するコンテンツがありません","saveError":"保存に失敗しました"},"emptyButtons":"ボタンがありません。「ボタン追加」をクリックして作成してください。"}],
  "whitelist": [null, null, {"title":"SSOホワイトリスト","subtitle":"SSOログインを許可するメールアドレスを管理","loading":"読み込み中…","buttons":{"add":"追加","edit":"編集","delete":"削除","cancel":"キャンセル","confirmDelete":"削除確認","retry":"再試行","close":"閉じる"},"table":{"email":"メールアドレス","desc":"備考","time":"追加日時","actions":"操作"},"form":{"email":"メールアドレス","emailPlaceholder":"user@example.com","desc":"備考","descPlaceholder":"任意の備考","emailDisabled":"メールアドレスは変更できません"},"empty":{"title":"ホワイトリストがありません","desc":"メールアドレスを追加してSSOログインを許可してください。"},"delete":{"title":"削除確認","desc":"このホワイトリストを削除してもよろしいですか？削除後はSSOログインができなくなります。"},"toast":{"added":"ホワイトリストを追加しました。","updated":"ホワイトリストを更新しました。","deleted":"ホワイトリストを削除しました: {{email}}","saveError":"保存に失敗しました。","deleteError":"削除に失敗しました。","fetchError":"取得に失敗しました。"},"error":{"title":"エラー","login":"ログインしていません","permission":"権限が不足しています","notFound":"コレクションが見つかりません"}}],
  "imagePicker": [null, null, {"defaultLabel":"画像","preview":"プレビュー","uploadOrSelect":"画像をアップロードまたはライブラリから選択","uploading":"アップロード中...","upload":"画像をアップロード","selectFromLib":"ライブラリから選択","uploadError":"アップロード失敗","retry":"再試行してください"}],
  "mediaLibraryModal": [null, null, {"title":"ライブラリから画像を選択","loading":"読み込み中…","search":"画像を検索...","noResults":"条件に一致する画像が見つかりません","empty":"メディアライブラリに画像がありません","image":"画像","clickToSelect":"クリックして選択","unknown":"不明","fetchError":"メディアリストの取得に失敗しました"}],
  "menuBar": [null, null, {"bold":"太字 (Ctrl+B)","italic":"斜体 (Ctrl+I)","sourceMode":"ソースモード (HTML)","wysiwygMode":"リッチテキストモード","sourceModeHint":"現在はソースモードです。HTML を直接貼り付けできます。","sourceModePlaceholder":"ここに HTML ソースを貼り付け、または編集してください...","heading1":"見出し 1","heading2":"見出し 2","heading3":"見出し 3","bulletList":"箇条書き","orderedList":"番号付きリスト","quote":"引用","link":"リンクを挿入","uploadImage":"画像をアップロード","selectFromLibrary":"メディアライブラリから選択","linkDialog":{"title":"リンクを挿入","label":"リンクURL","placeholder":"https://example.com","cancel":"キャンセル","confirm":"確認"}}],
  "mcsm": [null, null, {"title":"MCSM パネル管理","subtitle":"MCSManager サーバーインスタンスをリモート管理","loading":"MCSM データを読み込み中...","refresh":"更新","error":{"loadFailed":"MCSM 設定の読み込みに失敗しました"},"tabs":{"dashboard":"ダッシュボード","instances":"インスタンス","console":"コンソール","files":"ファイル","settings":"設定"},"status":{"busy":"ビジー","stopped":"停止","stopping":"停止中","starting":"起動中","running":"実行中"},"settings":{"panelUrl":"パネルURL","apiKey":"API Key","enabled":"MCSM 統合を有効にする","cacheTtl":"公開キャッシュ TTL","instanceLabels":"インスタンスラベル","labelName":"表示名","hiddenInstances":"非表示インスタンス","hiddenDesc":"非表示のインスタンスは公開サーバー情報ページに表示されません","save":"設定を保存","saveSuccess":"MCSM 設定を保存しました","saveError":"設定の保存に失敗しました","testConnection":"接続テスト","testSuccess":"接続成功","testFailed":"接続に失敗しました。パネルURLとAPI Keyを確認してください。"},"dashboard":{"loading":"パネルデータを読み込み中...","version":"パネルバージョン","nodes":"ノード数","instances":"インスタンス (実行中/合計)","system":"システムリソース","nodeList":"ノード一覧","online":"オンライン","offline":"オフライン","instanceCount":"{{count}} インスタンス"},"instances":{"title":"インスタンス一覧","empty":"インスタンスがありません","start":"起動","stop":"停止","restart":"再起動","kill":"強制終了","confirmKill":"このインスタンスを強制終了しますか？データが失われる可能性があります。","actionSuccess":"操作 {{action}} を実行しました","actionError":"操作 {{action}} に失敗しました","hide":"非表示","unhide":"表示する","rename":"名前変更","hidden":"非表示","renamePrompt":"新しい表示名を入力"},"console":{"selectInstance":"インスタンスを選択","selectPlaceholder":"インスタンスを選択してください...","noOutput":"出力ログはまだありません","commandPlaceholder":"コマンドを入力して Enter で送信...","sendError":"コマンドの送信に失敗しました"},"files":{"selectInstance":"インスタンスを選択","listError":"ファイル一覧の取得に失敗しました","empty":"ディレクトリは空です","newFolder":"新規フォルダ","newFile":"新規ファイル","folderName":"フォルダ名","fileName":"ファイル名","create":"作成","edit":"編集","delete":"削除","confirmDelete":"選択したファイル/フォルダを削除しますか？","save":"保存","cancel":"キャンセル","saveSuccess":"ファイルを保存しました"}}],
  "guard": [null, null, {"verifying":"確認中..."}]
};
const localize = (value, index) => Array.isArray(value) ? value[index] ?? undefined
  : typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localize(child, index)]).filter(([, child]) => child !== undefined))
    : value;
const resources = Object.fromEntries(["zh", "en", "ja"].map((locale, index) => [locale, localize(messages, index)]));

for (const locale of Object.values(resources)) {
  locale.common.backToDocs = locale.docs.common.backToDocs;
}

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem("i18nextLng") || "zh",
  fallbackLng: "zh",
  ns: ["common", "home", "docs", "admin"],
  nsSeparator: ".",
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
