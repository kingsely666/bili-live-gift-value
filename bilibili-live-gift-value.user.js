// ==UserScript==
// @name         B站直播间礼物价值标注（电池）
// @name:en      Bilibili Live Gift Value Badge
// @namespace    https://workbuddy.local/blgv
// @version      1.2.1
// @description  只在聊天栏「观众送出的礼物」播报后标注价值（默认电池数），不碰送礼面板/礼物列表；网页内设置面板，修改后保存才生效；自动同步 B 站新增礼物，支持人民币、单价/本次总价、连击实时更新、本场累计。
// @description:en Show each gift's value in batteries after gift messages in Bilibili live chat, with an in-page settings panel, online price sync and session totals.
// @author       WorkBuddy
// @license      MIT
// @match        https://live.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      api.live.bilibili.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

// 发布到 Greasy Fork 的注意事项（不影响运行，可整段删除）：
// 1. @namespace 必须保持 https://workbuddy.local/blgv 不变，Tampermonkey 才认作同一个脚本、
//    能原地升级；改成 greasyfork.org/users/xxx 会被当成新脚本，与本地版并存两份。
// 2. @description 只放一句话（列表页会截断），详细说明请填在 Greasy Fork 表单的「附加信息」里。
//    若写了 @name:xx 本地化名称，必须同时写非空的 @description:xx，否则 Greasy Fork 会拒绝导入。
// 3. 每次发布都要把 @version 往上加，Greasy Fork 才会推送更新。
// 4. @downloadURL / @updateURL 由 Greasy Fork 自动注入，不用手写。

/*
 * 原理说明
 * ------------------------------------------------------------------
 * 1) 价格来源：官方礼物面板接口
 *    https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/roomGiftList
 *    其中 price 的单位是「金瓜子/厘」：price / 1000 = 元，price / 100 = 电池。
 *    例：摸摸头 price=1500 -> 15 电池（1.5 元）；舰长一号 price=198000 -> 1980 电池（198 元）。
 *    先用 room/v1/Room/get_info 取分区，带 area_id / area_parent_id 才能拿全活动礼物。
 *    接口结果缓存 6 小时；请求失败时自动回退到内置价格表（脚本内 FALLBACK 常量）。
 * 2) 标注范围：**仅限聊天栏里「观众送出礼物」的播报条目**（.chat-items > .chat-item.gift-item）。
 *    送礼面板 / 礼物列表 / 背包 / 礼物弹层里的礼物格子同样常叫 .gift-item，
 *    因此按「区域 + 文案」双重限定：必须在聊天消息列表容器内，或文本含「投喂/赠送/送出」等播报词；
 *    命中送礼面板等排除区一律跳过；启动时还会清理历史上误插入面板的徽章。
 *    连击（Combo）会在同一个节点上改数量，所以另有 1 秒一次的轻量重扫来刷新标注。
 * 3) 官方上新礼物后：无需更新插件、无需改脚本。
 *    - 只要礼物出现在官方价格面板接口里，脚本运行时就会拿到它的价格；
 *    - 「刷新一下网页」一定会重新拉在线价格表（启动时强制在线同步，不会被缓存挡住），
 *      这是最省心的日常用法；
 *    - 页面打开时先用内置表立即渲染，同时拉在线全量礼物表（公开接口，无需登录）；
 *    - 直播中每 30 分钟后台静默同步，页面从后台切回超过 30 分钟也会同步；
 *    - 出现「价格表查不到」的礼物名时，60 秒节流触发一次在线同步，拿到后自动回补标注；
 *    - 内置 FALLBACK / 本地缓存只在接口不可用时兜底，不需要因为官方上新礼物而手工维护。
 *    以上自动同步可在设置面板里关闭；也可在面板里点「刷新礼物价格表」手动同步。
 * 4) 设置放在网页主界面：油猴菜单只留 2 项（总开关 + 展开设置入口），点「展开设置」
 *    在页面中央打开设置面板，7 项配置与刷新价格表 / 重置累计 / 运行状态都在面板里。
 *    面板里的改动只写进草稿，点「保存」才写入配置并重新标注；「取消」、关闭、点遮罩、
 *    按 Esc 一律放弃草稿。菜单里再点一次「收起设置」也能关闭面板。
 * 5) 脚本只读页面与公开接口，不发送任何弹幕、不下单、不改动 B 站业务逻辑。
 *
 * 更新日志
 * ------------------------------------------------------------------
 * v1.2.1：补齐 @description:en，与 @name:en 成对，满足 Greasy Fork 的本地化字段校验。
 * v1.2.0：设置改为网页内面板，改动需点「保存」确认后生效；原本挂在油猴菜单上的
 *         刷新价格表 / 查看运行状态 / 重置累计，一并移入面板「工具与状态」区。
 *
 * 只想在这一个直播间生效？把 @match 改成：
 * // @match        https://live.bilibili.com/1848766958*
 * ------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ============ 内置兜底价格表（礼物名 -> 电池数），接口不可用时启用 ============
  // 取自 2026-11 官方礼物面板，共 89 件常见礼物；活动/限定礼物以在线接口为准。
  const FALLBACK = {"爱之魔力":280,"启航之旅":1000,"摸摸头":15,"情书":52,"甜滋滋":50,"总督一号":199980,"探索者启航（荣耀启航）":22330,"月桂皇冠":4000,"提督一号":19980,"专属灯牌":50,"小电视飞船（荣耀飞船）":29990,"告白花束":199,"泡泡机":50,"转运锦鲤":6660,"飞屋环游":5000,"小电视飞船":29990,"爱的乐章":1990,"星愿水晶球（荣耀水晶）":1000,"极速超跑（闪烁疾驰）":1000,"你真好看":10,"心动卡":1,"舰长一号":1980,"心动盲盒":150,"次元之城（荣耀之城）":12450,"真好听":10,"花式夸夸（疯狂点赞）":299,"冲浪":899,"旋转木马":520,"粉丝团灯牌":1,"饭团":1,"捏捏小脸":99,"凡外星河":6660,"薯条":1,"领航者飞船":12450,"冰晶吊坠":299,"bilibili世界":30000,"人气票":1,"梦幻游乐园":30000,"极速超跑（流光飞电）":1000,"bilibili星跃":10000,"牛哇牛哇":1,"花式夸夸（震撼声浪）":299,"梦游仙境":3000,"任意门":9999,"极速超跑":1000,"比心":10,"咩咩来咯":5200,"极速超跑（火力全开）":1000,"告白气球":2000,"鸿运小电视":10000,"千纸鹤":52,"送花花":10,"友谊的小船":49,"私人飞机":1000,"打call":2,"撒花":99,"花式夸夸（闪光应援）":299,"好运花生":28880,"星轨列车":6666,"探索者启航":22330,"星轨列车（荣耀列车）":6666,"花式夸夸":299,"流星雨":299,"海湾之旅":7999,"天蝎座娃娃":1990,"钻石戒指":199,"落日飞车":2000,"幸运盲盒":50,"鎏金小电视":29990,"干杯之旅":100,"音乐盒":99,"灿烂烟花":520,"小花花":1,"为你摘星":5200,"喜欢你（钟意你）":99,"贴贴":15,"做我的小猫":99,"次元之城":12450,"摩天轮":1000,"梦游仙境（荣耀仙境）":3000,"原地求婚":5200,"喜欢你":99,"星愿水晶球":1000,"水晶鞋":99,"心动时刻":50,"666":10,"梦幻邮轮":3000,"鼓鼓掌":5,"亲密之旅":500};

  // 免费（银瓜子 / 包裹）礼物，不计电池
  const FREE_NAMES = new Set(['小心心', '辣条', '亿圆', '小星星', '喵娘']);

  const API = 'https://api.live.bilibili.com';
  const CFG_KEY = 'blgv_cfg_v1';
  const PRICE_KEY = 'blgv_prices_v1_';
  const CACHE_TTL = 6 * 60 * 60 * 1000;      // 缓存有效期（跨页面加载省一次请求）
  const AUTO_SYNC_MS = 30 * 60 * 1000;       // 直播中后台同步周期
  const SYNC_GAP_MS = 60 * 1000;             // 遇到新礼物时触发同步的最小间隔
  const BADGE_CLASS = 'blgv-badge';

  const DEFAULTS = {
    enabled: true,        // 总开关
    unit: 'battery',      // battery | cny | both
    basis: 'total',       // total（本次总价 = 单价 x 数量）| unit（单个礼物单价）
    showFormula: false,   // 数量 > 1 时显示「15x10=150电池」
    showUnknown: false,   // 查不到价格的礼物是否也标注
    cumulative: false,    // 是否显示本场累计浮条
    autoSync: true        // 自动同步 B 站新增礼物
  };

  // ============ 存储封装（兼容没有 GM_* 的环境时用 localStorage 兜底） ============
  const store = {
    get(key, def) {
      try {
        const v = GM_getValue(key, undefined);
        if (v !== undefined && v !== null) return v;
      } catch (e) { /* ignore */ }
      try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
    },
    set(key, value) {
      try { GM_setValue(key, value); } catch (e) { /* ignore */ }
      try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
  };

  let cfg = Object.assign({}, DEFAULTS);
  try { cfg = Object.assign({}, DEFAULTS, JSON.parse(store.get(CFG_KEY, '{}'))); } catch (e) { /* ignore */ }
  function saveCfg() { store.set(CFG_KEY, JSON.stringify(cfg)); }

  // ============ 运行状态 ============
  let roomId = readRoomId();
  let priceByName = new Map();   // 礼物名 -> 电池数
  let sortedNames = [];          // 按长度倒序，用于文本里最长匹配
  let priceSource = '内置价格表';
  let markedCount = 0;
  let sessionTotal = 0;          // 本场累计电池
  let retryCount = 0;
  let lastSyncAt = 0;            // 最近一次在线同步成功时间
  let ready = false;             // 首次价格表加载是否完成
  let inflight = null;           // 正在进行的同步 Promise（防并发）
  let hasOnlineTable = false;    // 是否已拿到过在线价格表（后台同步失败时保留旧表）
  let pendingUnknown = false;    // 有未知礼物待同步（由每秒重扫驱动，避免后台标签页定时器被限流）
  const seenUnknown = new Set(); // 已见过的未知礼物名
  const badgeMap = new WeakMap();   // item -> { el, anchor }
  let contribMap = new WeakMap();   // item -> 上次已计入的电池数

  function readRoomId() {
    const p = location.pathname || '';
    let m = p.match(/\/(\d{2,12})(?:\/|$)/) || p.match(/(\d{3,12})/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('room_id') || '0';
  }

  // ============ 样式 ============
  function injectStyle() {
    if (document.getElementById('blgv-style')) return;
    const st = document.createElement('style');
    st.id = 'blgv-style';
    st.textContent = `
      .${BADGE_CLASS}{
        display:inline-block;margin-left:5px;padding:0 6px;
        font-size:11px;line-height:16px;font-weight:600;
        border-radius:9px;vertical-align:middle;white-space:nowrap;
        letter-spacing:0;user-select:none;cursor:help;
        background:rgba(245,158,11,.14);color:#a35c00;
        border:1px solid rgba(245,158,11,.35);
        font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      .${BADGE_CLASS}.blgv-free{background:rgba(120,140,160,.12);color:#6b7a8d;border-color:rgba(120,140,160,.3)}
      .${BADGE_CLASS}.blgv-unknown{background:rgba(120,140,160,.12);color:#6b7a8d;border-color:rgba(120,140,160,.3)}
      /* 双保险：即使 B 站改版导致误插入，送礼面板内也绝不显示徽章 */
      .gift-panel .${BADGE_CLASS}, #gift-panel .${BADGE_CLASS},
      [class*="gift-panel"] .${BADGE_CLASS}, [class*="giftPanel"] .${BADGE_CLASS},
      [class*="gift-popup"] .${BADGE_CLASS}, [class*="gift-dialog"] .${BADGE_CLASS},
      [class*="gift-modal"] .${BADGE_CLASS}, [class*="gift-drawer"] .${BADGE_CLASS},
      [class*="send-gift"] .${BADGE_CLASS}, [class*="gift-send"] .${BADGE_CLASS},
      [class*="gift-list"] .${BADGE_CLASS}, [class*="bag-panel"] .${BADGE_CLASS},
      [class*="gift-rank"] .${BADGE_CLASS}{display:none!important}
      html.blgv-dark .${BADGE_CLASS}{
        background:rgba(255,180,60,.16);color:#ffc866;border-color:rgba(255,180,60,.38);
      }
      html.blgv-dark .${BADGE_CLASS}.blgv-free,
      html.blgv-dark .${BADGE_CLASS}.blgv-unknown{color:#a9b6c6;background:rgba(160,180,200,.12);border-color:rgba(160,180,200,.3)}
      #blgv-total{
        position:fixed;right:18px;bottom:18px;z-index:99999;
        padding:7px 12px;border-radius:10px;font-size:12px;font-weight:600;
        background:rgba(255,255,255,.94);color:#a35c00;
        border:1px solid rgba(245,158,11,.4);box-shadow:0 3px 14px rgba(0,0,0,.16);
        pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      html.blgv-dark #blgv-total{background:rgba(32,34,40,.94);color:#ffc866;border-color:rgba(255,180,60,.4)}
      .blgv-toast{
        position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:100000;
        padding:8px 16px;border-radius:8px;font-size:13px;
        background:rgba(32,34,40,.92);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.2);
        pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      .blgv-toast.blgv-warn{background:rgba(176,88,20,.94)}

      /* ===== 网页内设置面板 ===== */
      #blgv-settings-mask{position:fixed;inset:0;z-index:99997;background:rgba(0,0,0,.32)}
      #blgv-settings{
        position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
        width:min(440px,calc(100vw - 24px));max-height:min(76vh,720px);
        display:flex;flex-direction:column;z-index:99998;
        background:#fff;color:#1f2329;border:1px solid #e3e5e7;border-radius:14px;
        box-shadow:0 18px 48px rgba(0,0,0,.22);overflow:hidden;
        font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      html.blgv-dark #blgv-settings{background:#23262c;color:#e3e5e7;border-color:#3b4048}
      #blgv-settings *{box-sizing:border-box}
      .blgv-s-head{display:flex;align-items:center;justify-content:space-between;flex:none;padding:14px 18px;border-bottom:1px solid #e3e5e7}
      html.blgv-dark .blgv-s-head{border-color:#3b4048}
      .blgv-s-title{font-size:15px;font-weight:700}
      .blgv-s-close{border:0;background:transparent;color:#9499a0;font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
      .blgv-s-close:hover{color:#fb7299}
      .blgv-s-body{flex:1;overflow-y:auto;padding:6px 18px 14px}
      .blgv-s-group{margin-top:14px}
      .blgv-s-group>h4{margin:0 0 6px;font-size:12px;font-weight:600;color:#9499a0;letter-spacing:.5px}
      .blgv-s-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:4px 0}
      .blgv-s-row+.blgv-s-row{border-top:1px solid #f1f2f3}
      html.blgv-dark .blgv-s-row+.blgv-s-row{border-color:#2e323a}
      .blgv-s-label{display:flex;flex-direction:column;gap:2px;min-width:0}
      .blgv-s-label>b{font-weight:500;font-size:13px}
      .blgv-s-label>small{font-size:11px;line-height:1.4;color:#9499a0}
      .blgv-s-seg{display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:8px;background:#f1f2f3}
      html.blgv-dark .blgv-s-seg{background:#2e323a}
      .blgv-s-seg label{position:relative;cursor:pointer}
      .blgv-s-seg input{position:absolute;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
      .blgv-s-seg span{display:block;padding:5px 9px;border-radius:6px;white-space:nowrap;font-size:12px;color:#61666d;transition:background .15s,color .15s}
      html.blgv-dark .blgv-s-seg span{color:#a2a7ae}
      .blgv-s-seg input:checked+span{background:#fb7299;color:#fff;font-weight:600}
      .blgv-s-seg input:focus-visible+span{outline:2px solid #fb7299;outline-offset:1px}
      .blgv-s-switch{position:relative;flex:none;width:38px;height:22px;cursor:pointer}
      .blgv-s-switch input{position:absolute;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
      .blgv-s-track{display:block;width:38px;height:22px;border-radius:11px;background:#c9ccd0;transition:background .18s}
      .blgv-s-track:after{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .18s}
      .blgv-s-switch input:checked+.blgv-s-track{background:#fb7299}
      .blgv-s-switch input:checked+.blgv-s-track:after{transform:translateX(16px)}
      .blgv-s-switch input:focus-visible+.blgv-s-track{outline:2px solid #fb7299;outline-offset:2px}
      .blgv-s-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
      .blgv-s-btn{border:1px solid #e3e5e7;border-radius:8px;background:#fff;color:#1f2329;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
      html.blgv-dark .blgv-s-btn{background:#2b2f36;color:#e3e5e7;border-color:#3b4048}
      .blgv-s-btn:hover{border-color:#fb7299;color:#fb7299}
      .blgv-s-status{margin-top:10px;padding:9px 11px;border-radius:8px;background:#f6f7f8;color:#61666d;font-size:11px;line-height:1.7;white-space:pre-line;word-break:break-all}
      html.blgv-dark .blgv-s-status{background:#2b2f36;color:#a2a7ae}
      .blgv-s-foot{display:flex;align-items:center;gap:10px;flex:none;padding:12px 18px;border-top:1px solid #e3e5e7}
      html.blgv-dark .blgv-s-foot{border-color:#3b4048}
      .blgv-s-hint{flex:1;font-size:11px;color:#9499a0}
      .blgv-s-hint.blgv-s-dirty{color:#fb7299}
      .blgv-s-link{border:0;background:none;color:#9499a0;padding:6px 2px;font-size:12px;cursor:pointer;font-family:inherit}
      .blgv-s-link:hover{color:#fb7299}
      .blgv-s-save{border:0;border-radius:8px;background:#fb7299;color:#fff;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
      .blgv-s-save:hover{background:#fc8bab}
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function toast(msg, warn) {
    try {
      const el = document.createElement('div');
      el.className = 'blgv-toast' + (warn ? ' blgv-warn' : '');
      el.textContent = msg;
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { el.remove(); }, 3200);
    } catch (e) { /* ignore */ }
  }

  // 依据聊天栏底色判断深浅色主题，保证徽章文字始终可读
  function detectTheme() {
    try {
      let el = document.querySelector('.chat-history-panel, .chat-items, #chat-items, .aside-area');
      let bg = '';
      while (el && el !== document.documentElement) {
        const c = getComputedStyle(el).backgroundColor;
        const m = (c || '').match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
        if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) { bg = c; break; }
        el = el.parentElement;
      }
      const m = bg.match(/(\d+),\s*(\d+),\s*(\d+)/);
      const lum = m ? (0.299 * (+m[1]) + 0.587 * (+m[2]) + 0.114 * (+m[3])) : 255;
      document.documentElement.classList.toggle('blgv-dark', lum < 128);
    } catch (e) { /* ignore */ }
  }

  // ============ 网络请求 ============
  function request(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          timeout: 12000,
          onload: function (r) {
            if (r.status >= 200 && r.status < 300) resolve(r.responseText);
            else reject(new Error('HTTP ' + r.status));
          },
          onerror: function () { reject(new Error('network error')); },
          ontimeout: function () { reject(new Error('timeout')); }
        });
      } else {
        fetch(url, { credentials: 'omit' })
          .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
          .then(resolve, reject);
      }
    });
  }

  // 递归收集所有形似礼物的对象（覆盖 base_config / room_config / 活动礼物）
  function collectGifts(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) collectGifts(node[i], out, depth + 1);
      return;
    }
    if (typeof node.name === 'string' && typeof node.price === 'number' && typeof node.id === 'number') {
      out.push([node.name.trim(), Math.round(node.price / 100 * 100) / 100]); // price/100 = 电池
    }
    for (const k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      const v = node[k];
      if (v && typeof v === 'object') collectGifts(v, out, depth + 1);
    }
  }

  function rebuildPriceMap(list) {
    priceByName = new Map();
    for (const pair of list) {
      const name = String(pair[0] || '').trim();
      const bat = Number(pair[1]);
      if (name && !priceByName.has(name) && isFinite(bat)) priceByName.set(name, bat);
    }
    // 在线表缺的礼物用内置表补齐；免费礼物与红包也要参与「名字识别」，否则会被整条跳过
    for (const k in FALLBACK) if (!priceByName.has(k)) priceByName.set(k, FALLBACK[k]);
    FREE_NAMES.forEach(function (n) { if (!priceByName.has(n)) priceByName.set(n, 0); });
    if (!priceByName.has('发红包')) priceByName.set('发红包', 0);
    sortedNames = Array.from(priceByName.keys()).sort(function (a, b) { return b.length - a.length; });
  }

  function applyFallback() {
    rebuildPriceMap(Object.keys(FALLBACK).map(function (k) { return [k, FALLBACK[k]]; }));
    priceSource = '内置兜底表';
  }

  // 读取上次成功拉取的礼物表；strict=true 时要求缓存未过期
  function readCache(key, strict) {
    try {
      const c = JSON.parse(store.get(key, 'null'));
      if (!c || !Array.isArray(c.list) || c.list.length <= 10) return null;
      if (strict && (!c.ts || Date.now() - c.ts >= CACHE_TTL)) return null;
      return c.list;
    } catch (e) { return null; }
  }

  // 包装一层：同一时刻只允许一个同步请求在跑
  function loadPrices(force, silent) {
    if (inflight) return inflight;
    inflight = doLoadPrices(force, silent).then(
      function () { inflight = null; },
      function () { inflight = null; }
    );
    return inflight;
  }

  async function doLoadPrices(force, silent) {
    const key = PRICE_KEY + roomId;
    if (!force) {
      const cached = readCache(key, true);
      if (cached) {
        rebuildPriceMap(cached);
        priceSource = '本地缓存（' + cached.length + ' 件）';
        hasOnlineTable = true;
        ready = true;
        lastSyncAt = 0;   // 缓存不算在线同步，遇到新礼物名会立刻去查接口
        rescanAll();
        return;
      }
    }

    // 先取分区号，带分区参数才能拿全活动礼物
    let info = {};
    try {
      const txt = await request(API + '/room/v1/Room/get_info?room_id=' + encodeURIComponent(roomId));
      const j = JSON.parse(txt);
      if (j.code === 0 && j.data) {
        info = { room_id: j.data.room_id, area_id: j.data.area_id, parent_area_id: j.data.parent_area_id };
      }
    } catch (e) { /* 不带分区也能拿到基础礼物 */ }

    const realId = info.room_id || roomId;
    let url = API + '/xlive/web-room/v1/giftPanel/roomGiftList?platform=pc&room_id=' + encodeURIComponent(realId);
    if (info.area_id) {
      url += '&area_parent_id=' + encodeURIComponent(info.parent_area_id) + '&area_id=' + encodeURIComponent(info.area_id);
    }

    try {
      const txt = await request(url);
      const j = JSON.parse(txt);
      if (j.code !== 0 || !j.data) throw new Error('接口返回 code=' + j.code);
      const gifts = [];
      collectGifts(j.data.gift_config, gifts, 0);
      // 去重（同名保留首次出现）
      const seen = new Set();
      const list = [];
      for (const g of gifts) {
        if (!g[0] || seen.has(g[0])) continue;
        seen.add(g[0]);
        list.push(g);
      }
      if (list.length < 10) throw new Error('礼物列表为空');

      const oldNames = new Set(priceByName.keys());
      rebuildPriceMap(list);
      const added = Array.from(priceByName.keys()).filter(function (n) { return !oldNames.has(n); }).length;

      priceSource = '在线接口（' + list.length + ' 件）';
      store.set(key, JSON.stringify({ ts: Date.now(), list: list }));
      hasOnlineTable = true;
      retryCount = 0;
      lastSyncAt = Date.now();
      ready = true;
      rescanAll();   // 关键：把之前标「价格未知」的礼物回补成正确价格
      if (silent) {
        if (added > 0) toast('已同步 ' + added + ' 件新增礼物');
      } else {
        toast('礼物价格表已加载：' + list.length + ' 件礼物' + (added > 0 ? '（新增 ' + added + ' 件）' : ''));
      }
    } catch (e) {
      let offlineLabel;
      if (hasOnlineTable) {
        // 已有在线表时保留旧价格，不能因为一次后台刷新失败就把活动礼物全丢掉
        priceSource = '上次在线结果（本次同步失败，沿用旧表）';
        offlineLabel = '本次同步失败，沿用上次价格表';
      } else {
        // 首次就失败：优先用上次缓存的完整礼物表，比内置的常见礼物表更全
        const cached = readCache(key, false);
        if (cached) {
          rebuildPriceMap(cached);
          priceSource = '本地缓存（离线，' + cached.length + ' 件）';
          hasOnlineTable = true;
          offlineLabel = '接口不可用，已使用本地缓存价格表（' + cached.length + ' 件）';
        } else {
          applyFallback();
          priceSource = '接口失败，使用内置兜底表';
          offlineLabel = '礼物接口不可用，已使用内置价格表（' + priceByName.size + ' 件）';
        }
      }
      ready = true;
      if (!silent) toast(offlineLabel, true);
      if (retryCount < 3) { retryCount++; setTimeout(function () { loadPrices(true, true); }, 60000); }
      rescanAll();
    }
  }

  // 出现没见过的礼物名 -> 标记待同步；由每秒重扫在 60 秒节流到期后真正发起请求
  function noteUnknown(name) {
    if (!cfg.autoSync || !ready || !name) return;
    if (seenUnknown.has(name)) return;   // 同一名字只触发一次，其余交给定时同步
    seenUnknown.add(name);
    pendingUnknown = true;
    maybeSyncOnDemand();
  }

  function maybeSyncOnDemand() {
    if (!pendingUnknown || !cfg.autoSync || inflight) return;
    if (Date.now() - lastSyncAt < SYNC_GAP_MS) return;   // 节流中，等下一次重扫再看
    pendingUnknown = false;
    loadPrices(true, true);
  }

  // ============ 数值格式化 ============
  function fmtNum(n) {
    return Number.isInteger(n) ? n.toLocaleString('zh-CN')
      : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  // 1 元 = 10 电池
  function fmtValue(bat) {
    const b = fmtNum(bat);
    const c = '¥' + fmtNum(Math.round(bat / 10 * 100) / 100);
    if (cfg.unit === 'cny') return c;
    if (cfg.unit === 'both') return b + '电池 / ' + c;
    return b + '电池';
  }

  function lookupPrice(name) {
    if (!name) return null;
    if (FREE_NAMES.has(name)) return { battery: 0, free: true };
    if (name.indexOf('红包') >= 0) return { battery: 0, variable: true };
    if (priceByName.has(name)) return { battery: priceByName.get(name) };
    // 「荣耀/限定」等带括号后缀的礼物，去掉括号再试一次
    const base = name.replace(/[（(][^)）]*[)）]/g, '').trim();
    if (base && priceByName.has(base)) return { battery: priceByName.get(base) };
    return null;
  }

  // ============ DOM 解析 ============
  const NAME_SEL = '[class*="gift-name"],[class*="giftName"],[class*="gift-title"]';
  const COUNT_SEL = '[class*="gift-total-count"],[class*="gift-count"],[class*="gift-num"],[class*="giftCount"]';
  const ITEM_SEL = '.gift-item,[data-type="gift"],.chat-item[class*="gift"]';

  // 聊天消息列表容器：只有这些容器里的礼物条目才是「观众送出的礼物」播报
  const CHAT_SEL = [
    '.chat-items', '#chat-items', '.chat-history-list', '.chat-history-panel',
    '.chat-list', '.chat-content-list', '.chat-message-list',
    '[class*="chat-items"]', '[class*="chatItems"]', '[class*="chat-history"]',
    '[class*="chat-list"]', '[class*="chat-area"]', '.room-chat',
    '[class*="danmaku-list"]', '[class*="message-list"]'
  ].join(',');

  // 送礼面板 / 礼物列表 / 背包 / 礼物弹层 / 礼物榜：这些地方的礼物格子一律不标注
  const EXCLUDE_SEL = [
    '.gift-panel', '#gift-panel', '[class*="gift-panel"]', '[class*="giftPanel"]',
    '[class*="gift-popup"]', '[class*="gift-dialog"]', '[class*="gift-modal"]',
    '[class*="gift-drawer"]', '[class*="gift-float"]',
    '[class*="send-gift"]', '[class*="gift-send"]', '[class*="gift-ctrl"]',
    '[class*="gift-control"]', '[class*="bag-panel"]', '[class*="backpack"]',
    '[class*="gift-list"]', '[class*="giftList"]', '[class*="gift-rank"]',
    '[class*="rank-list"]', '[class*="guard-panel"]', '[class*="lottery-panel"]'
  ].join(',');

  // 聊天播报一定有动作词；送礼面板格子只有「礼物名 + 原价」，不含这些词
  const BROADCAST_RE = /投喂|赠送|送出|送给|打赏/;

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function inArea(el, sel) {
    if (!el || !el.closest) return false;
    try { return !!el.closest(sel); } catch (e) { return false; }
  }

  function looksLikeGiftItem(el) {
    if (!el || el.nodeType !== 1 || !el.classList) return false;
    if (el.classList.contains('gift-item') || el.getAttribute('data-type') === 'gift') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    // 宽松兼容：类名变体（如 gift-item-v2），但必须是聊天条目
    if (/gift/i.test(cls) && /chat-item|message-item/i.test(cls)) {
      try { return !!el.querySelector(NAME_SEL + ',' + COUNT_SEL); } catch (e) { return false; }
    }
    return false;
  }

  function isGiftItem(el) {
    if (!looksLikeGiftItem(el)) return false;
    // 聊天消息列表容器内 → 就是观众送礼播报，直接放行
    if (inArea(el, CHAT_SEL)) return true;
    // 明确属于送礼面板/礼物弹层 → 永不标注
    if (inArea(el, EXCLUDE_SEL)) return false;
    // 容器类名被 B 站改掉时，用播报文案兜底；面板格子不含动作词
    return BROADCAST_RE.test(el.textContent || '');
  }

  // 取除徽章以外的纯文本（徽章里的数字会干扰数量解析）
  function ownText(root, skipEl) {
    let s = '';
    try {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          return (skipEl && skipEl.contains(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = w.nextNode())) s += n.nodeValue + ' ';
    } catch (e) { s = root.textContent || ''; }
    return clean(s);
  }

  // 在文本里找最长的、能匹配价格表的礼物名；优先从「投喂/赠送」之后开始找
  function matchName(text) {
    if (!text) return null;
    let scope = text;
    const kw = text.search(/投喂|赠送|送出|送给|送出了/);
    if (kw >= 0) scope = text.slice(kw);
    for (let i = 0; i < sortedNames.length; i++) {
      if (scope.indexOf(sortedNames[i]) >= 0) return sortedNames[i];
    }
    return null;
  }

  function findDeepestNameEl(item, name) {
    if (!name) return null;
    let best = null;
    try {
      const els = item.querySelectorAll('*');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.children.length === 0 && clean(el.textContent) === name) best = el;
      }
    } catch (e) { /* ignore */ }
    return best;
  }

  function parseNumber(text) {
    if (!text) return null;
    let m = text.match(/[x×✕X*]\s*(\d{1,6})/);
    if (!m) m = text.match(/(\d{1,6})\s*(?:个|连击|件)/);
    if (!m) m = text.match(/^\s*(\d{1,6})\s*$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return (isFinite(n) && n > 0 && n < 100000) ? n : null;
  }

  function parseItem(item, badgeEl) {
    let nameEl = null, countEl = null;
    try { nameEl = item.querySelector(NAME_SEL); } catch (e) { /* ignore */ }
    try { countEl = item.querySelector(COUNT_SEL); } catch (e) { /* ignore */ }

    const text = ownText(item, badgeEl);
    let name = null;
    if (nameEl) {
      const t = clean(nameEl.textContent);
      if (priceByName.has(t)) name = t;
      else name = matchName(t);
    }
    if (!name) name = matchName(text);

    // 数量：优先用专门的数量节点，其次从礼物名之后的文字里找 xN
    let qty = 1;
    if (countEl) {
      const q = parseNumber(clean(countEl.textContent));
      if (q) qty = q;
    }
    if (qty === 1) {
      const idx = text.indexOf(name);
      const after = idx >= 0 ? text.slice(idx + name.length) : text;
      const q = parseNumber(after);
      if (q) qty = q;
    }

    let unknown = '';
    if (!name) {
      // 查不到价格时，仍尽量取出礼物名：既用于「价格未知」提示，也用于触发新增礼物同步
      unknown = nameEl ? clean(nameEl.textContent) : '';
      if (!unknown) {
        const m = text.match(/(?:投喂|赠送|送出|送给)(.{1,24})/);
        if (m) unknown = clean(m[1]).replace(/[x×✕X*]\s*\d+.*$/, '').trim();
      }
      if (unknown.length > 24) unknown = '';
    }
    if (!name && !unknown) return null;

    let anchor = countEl || nameEl || findDeepestNameEl(item, name || unknown) || item;
    if (badgeEl && badgeEl.contains(anchor)) anchor = item;
    return { name: name || unknown, qty: qty, anchor: anchor, unknown: !name };
  }

  // ============ 徽章读写（幂等，连击数量变化只更新文字） ============
  function setBadge(item, anchor, text, tip, kind) {
    let rec = badgeMap.get(item);
    if (!rec) {
      const el = document.createElement('span');
      el.className = BADGE_CLASS;
      rec = { el: el, anchor: null };
      badgeMap.set(item, rec);
      markedCount++;
    }
    const el = rec.el;
    if (rec.anchor !== anchor || !el.isConnected) {
      if (anchor === item) item.appendChild(el);
      else anchor.insertAdjacentElement('afterend', el);
      rec.anchor = anchor;
    }
    if (el.textContent !== text) el.textContent = text;
    if (el.title !== tip) el.title = tip;
    const cls = BADGE_CLASS + (kind ? ' blgv-' + kind : '');
    if (el.className !== cls) el.className = cls;
  }

  function removeBadge(item) {
    const rec = badgeMap.get(item);
    if (rec && rec.el) rec.el.remove();
  }

  function accumulate(item, bat) {
    const prev = contribMap.get(item) || 0;
    if (bat > prev) {
      sessionTotal += bat - prev;
      contribMap.set(item, bat);
      if (cfg.cumulative) renderCumulative();
    }
  }

  function annotate(item) {
    if (!cfg.enabled) { removeBadge(item); return; }
    const rec = badgeMap.get(item);
    const parsed = parseItem(item, rec ? rec.el : null);
    if (!parsed) return;

    const p = parsed.unknown ? null : lookupPrice(parsed.name);
    if (!p) {
      noteUnknown(parsed.name);   // 不管有没有开「价格未知」提示，都要去同步 B 站新上的礼物
      if (!cfg.showUnknown) { removeBadge(item); return; }
      setBadge(item, parsed.anchor, '价格未知',
        '未在礼物价格表中找到「' + parsed.name + '」，可能是活动/限定/盲盒礼物；脚本会自动同步，也可在设置面板点「刷新礼物价格表」。',
        'unknown');
      return;
    }

    if (p.variable) {
      setBadge(item, parsed.anchor, '金额不定', '红包金额由发送者自行设定，无法按固定单价换算。', 'unknown');
      return;
    }

    const unitB = p.battery;
    const totalB = unitB * parsed.qty;
    accumulate(item, totalB);   // 始终累计，浮条只是显示开关

    if (p.free || unitB === 0) {
      setBadge(item, parsed.anchor, '免费 · 0电池', '免费/包裹礼物，不计电池价值。', 'free');
      return;
    }

    const shown = cfg.basis === 'unit' ? unitB : totalB;
    let text = fmtValue(shown);
    if (cfg.showFormula && cfg.basis === 'total' && parsed.qty > 1) {
      text = fmtNum(unitB) + '×' + parsed.qty + '=' + fmtValue(totalB);
    }
    const tip = '礼物：' + parsed.name + '\n单价：' + fmtValue(unitB)
      + '\n数量：' + parsed.qty + '\n本次合计：' + fmtValue(totalB)
      + '\n价格来源：' + priceSource + '（1 元 = 10 电池）'
      + (parsed.name.indexOf('盲盒') >= 0 ? '\n注：盲盒按购买价计算，爆出礼物价值可能不同。' : '');
    setBadge(item, parsed.anchor, text, tip, null);
  }

  // ============ 扫描 / 观察 ============
  // 聊天容器优先；includeGlobal 用于启动/价格表刷新时兼容「容器类名改版」的场景，
  // 此时做一次全页兜底扫描，仍由 isGiftItem 把送礼面板格子全部挡掉。
  function collectItems(includeGlobal) {
    const out = [];
    const seen = new Set();
    let scopes = [];
    try { scopes = Array.from(document.querySelectorAll(CHAT_SEL)); } catch (e) { /* ignore */ }
    if (!scopes.length || includeGlobal) scopes.push(document);
    for (let s = 0; s < scopes.length; s++) {
      let list;
      try { list = scopes[s].querySelectorAll(ITEM_SEL); } catch (e) { continue; }
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (seen.has(el) || !isGiftItem(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function eachItem(fn) { collectItems(true).forEach(fn); }

  // 清掉旧版本可能误插到送礼面板等非聊天区里的徽章（覆盖安装后自动生效）
  function purgeBadges() {
    let list;
    try { list = document.querySelectorAll('.' + BADGE_CLASS); } catch (e) { return; }
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const host = b.parentElement && b.parentElement.closest(ITEM_SEL);
      // 只要徽章落在送礼面板区域（且不在聊天列表内），无条件移除
      const inPanel = inArea(b, EXCLUDE_SEL) && !inArea(b, CHAT_SEL);
      if (!inPanel && host && isGiftItem(host)) continue;
      if (host) badgeMap.delete(host);
      b.remove();
    }
  }

  function rescanAll() {
    eachItem(annotate);
    purgeBadges();
    renderCumulative();
    if (settingsOpen) renderStatus();   // 价格表同步后面板里的状态同步更新
  }

  let pending = new Set();
  let raf = 0;
  function flush() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      const list = Array.from(pending);
      pending.clear();
      for (let i = 0; i < list.length; i++) {
        if (list[i].isConnected && isGiftItem(list[i])) annotate(list[i]);
      }
    });
  }

  function startObserver() {
    const mo = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType !== 1) continue;
          // 整块是送礼面板/礼物弹层：连内部节点都不用看
          if (inArea(n, EXCLUDE_SEL) && !inArea(n, CHAT_SEL)) continue;
          if (isGiftItem(n)) { pending.add(n); continue; }
          // 兜底：一次性插入了一整块聊天列表
          if (n.querySelectorAll) {
            try {
              const inner = n.querySelectorAll(ITEM_SEL);
              for (let k = 0; k < inner.length; k++) {
                if (isGiftItem(inner[k])) pending.add(inner[k]);
              }
            } catch (e) { /* ignore */ }
          }
        }
      }
      if (pending.size) flush();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ============ 本场累计浮条 ============
  function renderCumulative() {
    let el = document.getElementById('blgv-total');
    if (!cfg.cumulative) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'blgv-total';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = '本场礼物累计 ' + fmtValue(sessionTotal);
  }

  // ============ 网页内设置面板 + 精简油猴菜单 ============
  let maskEl = null, panelEl = null, draft = null, settingsOpen = false;

  function cfgEqual(a, b) {
    return Object.keys(DEFAULTS).every(function (k) { return a[k] === b[k]; });
  }

  function toggleRow(key, title, desc) {
    return '<div class="blgv-s-row"><span class="blgv-s-label"><b>' + title + '</b>'
      + (desc ? '<small>' + desc + '</small>' : '') + '</span>'
      + '<label class="blgv-s-switch"><input type="checkbox" data-key="' + key
      + '"><span class="blgv-s-track"></span></label></div>';
  }

  function segRow(key, title, desc, options) {
    let s = '<div class="blgv-s-row"><span class="blgv-s-label"><b>' + title + '</b>'
      + (desc ? '<small>' + desc + '</small>' : '') + '</span><span class="blgv-s-seg">';
    for (let i = 0; i < options.length; i++) {
      s += '<label><input type="radio" name="blgv-' + key + '" data-key="' + key
        + '" value="' + options[i][0] + '"><span>' + options[i][1] + '</span></label>';
    }
    return s + '</span></div>';
  }

  function statusText() {
    const mins = lastSyncAt ? Math.round((Date.now() - lastSyncAt) / 60000) : null;
    return '房间：' + roomId
      + '\n价格来源：' + priceSource + '（' + priceByName.size + ' 件）'
      + '\n上次在线同步：' + (mins === null ? '尚未' : (mins === 0 ? '刚刚' : mins + ' 分钟前'))
      + '\n已标注：' + markedCount + ' 条'
      + '\n本场累计：' + fmtValue(sessionTotal)
      + '\n标注开关：' + (cfg.enabled ? '开' : '关');
  }

  function renderStatus() {
    const el = panelEl && panelEl.querySelector('#blgv-s-status');
    if (el) el.textContent = statusText();
  }

  function copyStatus() {
    const txt = statusText();
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
        (document.body || document.documentElement).appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        toast(ok ? '运行状态已复制' : '复制失败，请手动选中状态文字', !ok);
      } catch (e) { toast('复制失败，请手动选中状态文字', true); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('运行状态已复制'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  // 表单里的值一律先落到 draft，不直接改正在生效的 cfg
  function readForm() {
    const d = Object.assign({}, DEFAULTS);
    if (!panelEl) return d;
    const inputs = panelEl.querySelectorAll('[data-key]');
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i], k = el.dataset.key;
      if (el.type === 'checkbox') d[k] = el.checked;
      else if (el.type === 'radio' && el.checked) d[k] = el.value;
    }
    return d;
  }

  function fillForm() {
    if (!panelEl || !draft) return;
    const inputs = panelEl.querySelectorAll('[data-key]');
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i], v = draft[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = (el.value === v);
    }
    renderStatus();
  }

  function updateDirtyUI() {
    const hint = panelEl && panelEl.querySelector('#blgv-s-hint');
    if (!hint) return;
    const dirty = !!draft && !cfgEqual(draft, cfg);
    hint.textContent = dirty ? '有未保存的修改' : '修改后需点「保存」才会生效';
    hint.classList.toggle('blgv-s-dirty', dirty);
  }

  function buildPanel() {
    maskEl = document.createElement('div');
    maskEl.id = 'blgv-settings-mask';
    maskEl.addEventListener('click', function () { closeSettings(); });

    panelEl = document.createElement('div');
    panelEl.id = 'blgv-settings';
    panelEl.tabIndex = -1;
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', '礼物价值标注设置');
    panelEl.innerHTML =
      '<div class="blgv-s-head"><span class="blgv-s-title">礼物价值标注 · 设置</span>'
      + '<button type="button" class="blgv-s-close" data-act="close" aria-label="关闭">×</button></div>'
      + '<div class="blgv-s-body">'
      + '<div class="blgv-s-group"><h4>显示</h4>'
      + toggleRow('enabled', '启用标注', '关闭后聊天栏不再显示价值徽章')
      + segRow('unit', '显示单位', '1 元 = 10 电池', [['battery', '电池'], ['cny', '人民币'], ['both', '两者']])
      + segRow('basis', '价值口径', '总价按「单价 × 数量」计算', [['total', '本次总价'], ['unit', '单个单价']])
      + toggleRow('showFormula', '显示乘法明细', '数量大于 1 时显示「单价 × 数量 = 合计」')
      + toggleRow('cumulative', '本场累计浮条', '页面右下角显示本场礼物累计')
      + '</div>'
      + '<div class="blgv-s-group"><h4>识别与同步</h4>'
      + toggleRow('showUnknown', '未知礼物也标注', '查不到价格的活动 / 限定礼物显示「价格未知」')
      + toggleRow('autoSync', '自动同步新礼物', '每 30 分钟及遇到新礼物时在线更新价格表')
      + '</div>'
      + '<div class="blgv-s-group"><h4>工具与状态</h4>'
      + '<div class="blgv-s-tools">'
      + '<button type="button" class="blgv-s-btn" data-act="sync">刷新礼物价格表</button>'
      + '<button type="button" class="blgv-s-btn" data-act="reset">重置本场累计</button>'
      + '<button type="button" class="blgv-s-btn" data-act="copy">复制运行状态</button>'
      + '</div><div class="blgv-s-status" id="blgv-s-status"></div></div>'
      + '</div>'
      + '<div class="blgv-s-foot">'
      + '<button type="button" class="blgv-s-link" data-act="defaults">恢复默认</button>'
      + '<span class="blgv-s-hint" id="blgv-s-hint">修改后需点「保存」才会生效</span>'
      + '<button type="button" class="blgv-s-link" data-act="cancel">取消</button>'
      + '<button type="button" class="blgv-s-save" data-act="save">保存</button>'
      + '</div>';

    panelEl.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || !t.dataset || !t.dataset.key) return;
      draft = readForm();
      updateDirtyUI();
    });

    panelEl.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close' || act === 'cancel') closeSettings();
      else if (act === 'defaults') {
        draft = Object.assign({}, DEFAULTS);
        fillForm(); updateDirtyUI();
        toast('已填入默认值，点「保存」后生效');
      } else if (act === 'save') saveSettings();
      else if (act === 'sync') { toast('正在同步礼物价格表…'); loadPrices(true); }
      else if (act === 'reset') {
        sessionTotal = 0;
        contribMap = new WeakMap();
        renderCumulative(); renderStatus();
        toast('本场累计已重置');
      } else if (act === 'copy') copyStatus();
    });

    (document.body || document.documentElement).appendChild(maskEl);
    (document.body || document.documentElement).appendChild(panelEl);
  }

  function openSettings() {
    if (settingsOpen) { closeSettings(); return; }   // 菜单项兼作「收起设置」
    buildPanel();
    draft = Object.assign({}, cfg);
    fillForm();
    settingsOpen = true;
    updateDirtyUI();
    refreshMenu();
    panelEl.focus();
  }

  function closeSettings(silent) {
    if (!settingsOpen) return;
    const dirty = !!draft && !cfgEqual(draft, cfg);
    settingsOpen = false;
    if (maskEl) maskEl.remove();
    if (panelEl) panelEl.remove();
    maskEl = panelEl = draft = null;
    refreshMenu();
    if (dirty && !silent) toast('修改未保存，已放弃', true);
  }

  function saveSettings() {
    cfg = Object.assign({}, DEFAULTS, readForm());
    saveCfg();
    closeSettings(true);
    rescanAll();
    toast('设置已保存并生效');
  }

  // 油猴菜单只留 2 项：一个快捷总开关 + 一个网页内设置入口
  let menuIds = [];
  function refreshMenu() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) { try { GM_unregisterMenuCommand(id); } catch (e) { /* ignore */ } }
    }
    menuIds = [];
    function reg(label, fn) {
      if (typeof GM_registerMenuCommand === 'function') {
        try { menuIds.push(GM_registerMenuCommand(label, fn)); } catch (e) { /* ignore */ }
      }
    }
    reg('标注开关：[' + (cfg.enabled ? '开' : '关') + '] 点击切换', function () {
      cfg.enabled = !cfg.enabled;
      saveCfg();
      // 面板开着时让草稿与菜单操作保持一致，避免保存时把开关改回去
      if (settingsOpen && draft && panelEl) {
        draft.enabled = cfg.enabled;
        const box = panelEl.querySelector('input[data-key="enabled"]');
        if (box) box.checked = cfg.enabled;
        updateDirtyUI();
      }
      refreshMenu(); rescanAll();
    });
    reg(settingsOpen ? '⚙ 收起设置（网页内面板）' : '⚙ 展开设置（网页内面板）', function () {
      openSettings();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && settingsOpen) closeSettings();
  }, true);

  // ============ 启动 ============
  injectStyle();
  detectTheme();
  applyFallback();          // 接口返回前先用内置表，不漏掉开场的礼物
  refreshMenu();
  loadPrices(true);         // 每次打开/刷新页面都强制拉在线全量礼物表，保证官方新礼物立即生效
  rescanAll();              // 处理页面已存在的礼物播报
  startObserver();

  // 连击（Combo）会原地修改数量，定时重扫最近 60 条即可保持标注同步
  setInterval(function () {
    maybeSyncOnDemand();   // 新礼物触发的按需同步在这里到期执行（不依赖长定时器）
    if (!cfg.enabled) return;
    const items = collectItems();
    const start = Math.max(0, items.length - 60);
    for (let i = start; i < items.length; i++) annotate(items[i]);
  }, 1000);

  setInterval(function () { detectTheme(); purgeBadges(); }, 15000);

  // 直播中定期后台静默同步：B 站中途上新礼物也能自动跟上，不用刷新页面
  setInterval(function () {
    if (!cfg.autoSync) return;
    loadPrices(true, true);
  }, AUTO_SYNC_MS);

  // 标签页从后台切回时，若超过 30 分钟没同步，补一次
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !cfg.autoSync) return;
    if (Date.now() - lastSyncAt > AUTO_SYNC_MS) loadPrices(true, true);
  });

  // 站内跳转换房间时重新加载对应房间的礼物表
  let lastHref = location.href;
  setInterval(function () {
    if (location.href === lastHref) return;
    lastHref = location.href;
    roomId = readRoomId();
    sessionTotal = 0;
    markedCount = 0;
    hasOnlineTable = false;
    seenUnknown.clear();
    pendingUnknown = false;
    loadPrices(true);
    rescanAll();
  }, 2500);
})();
