# BTC / XAU 永续行情 · Chrome 扩展

Binance 永续合约的"瞥一眼"行情插件,可在 **BTCUSDT / XAUUSDT** 间切换(切换后角标、悬停、弹窗、K线、EMA 全跟着走,选择会被记住)。三层信息密度,适合上班偶尔看一下:

1. **图标角标(常驻)** — 实时价格缩写(如 `68.4`),24h 涨→绿底 / 跌→红底,断线转灰。余光可见,不用任何操作。
2. **悬停 tooltip(鼠标放图标上)** — 一行完整信息:价格 + 24h 涨跌% + 资金费率 + 结算倒计时。
3. **点击弹窗** — 大字价格、**可交互蜡烛图**(TradingView `lightweight-charts`:滚轮缩放、拖动平移、拖价格轴调高低、十字光标;`5m/15m/1h/4h/1d` 切换,默认 5m;叠加 EMA20 线(随周期自动重算))、资金费率/结算倒计时/24h 高低。弹窗右上角的 `WS实时 / 轮询5s` 标识显示数据来源。

数据走币安公开 WebSocket(`@ticker` + `@markPrice@1s`,实时推送,免 API key),K 线用 REST `fapi/v1/klines`。全部走浏览器现有网络/代理。

## 安装(加载未打包扩展)

1. 生成图标(首次):`python gen_icons.py`
2. Chrome 打开 `chrome://extensions/`
3. 右上角打开**开发者模式**
4. 点**加载已解压的扩展程序**,选择本文件夹 `btc-ticker-extension/`
5. 建议把图标**固定**到工具栏(点拼图图标 → 图钉)以便角标常驻可见

## 开发

- `npm test` — 跑纯函数单测(node 内置测试,无需安装依赖)
- 改完代码后在 `chrome://extensions/` 点该扩展的**刷新**按钮重新加载

## 文件结构

| 文件 | 职责 |
|---|---|
| `manifest.json` | MV3 配置 |
| `background.js` | service worker:WebSocket、角标 + tooltip、快照缓存 |
| `offscreen.html/js` | 常驻小页面,每 3 秒 REST 轮询保持角标/悬停信息新鲜(绕过 SW 休眠) |
| `popup.html/css/js` | 弹窗 UI + 交互式蜡烛图 |
| `format.js` | 纯函数(格式化 / 倒计时 / 缩写),被多处复用,可单测 |
| `vendor/lightweight-charts...js` | TradingView 官方图表库(本地打包,v4.2.3) |
| `gen_icons.py` | 生成橙色硬币图标 |
| `test/` | node 单测 |

## 已知边界 / 后续可加

- 仅 BTCUSDT 永续;多币种、价格预警、设置页暂未做(YAGNI,后续按需加)。
- 角标因字符数限制只显缩写价;完整价格在悬停 tooltip 和弹窗里。
