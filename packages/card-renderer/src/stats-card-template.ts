import { CardTheme } from "./card-config";
import { StatsCardViewModel } from "./stats-view-model";
import { statsFontFaceCss } from "./stats-fonts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape numeric text, then wrap thousands commas for optical spacing. */
function numberHtml(text: string): string {
  return escapeHtml(text).replace(/,/g, '<span class="num-sep">,</span>');
}

/**
 * ════════════════════════════════════════════════════════════════════
 *  BẢNG CHỈNH TAY — đổi số ở đây, KHÔNG cần sửa CSS bên dưới.
 *  Đơn vị: px CSS (renderer nhân ×2 → PNG 1040×480).
 *  Giá trị `null` = lấy theo STATS_CARD_THEME trong card-config.ts.
 *
 *  Áp dụng sau khi sửa:
 *    npx tsc -p packages/card-renderer
 *    npx jest packages/card-renderer/src/card-renderer.spec.ts --runInBand
 *    docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml build api
 *    docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d --remove-orphans
 * ════════════════════════════════════════════════════════════════════
 */
export interface StatsTuning {
  // ── Nền & khung card ───────────────────────────────────────────
  /** nền ngoài card; null = theme.background. */
  bodyBackground: string | null;
  /** nền thân card; null = theme.background. */
  cardBackground: string | null;
  /** bo góc thân card, px (0 = vuông). */
  cardRadius: number;
  /** độ đậm chữ toàn card (400). */
  cardWeight: number;
  /** căn dọc các hàng: space-between | flex-start | center. */
  cardJustify: string;
  /** kiểu chữ số: tabular-nums | normal. */
  fontVariantNumeric: string;
  /** padding trái/phải; null = lấy theme.rightPadding (16). */
  paddingX: number | null;
  /** padding trên (12). */
  paddingTop: number;
  /** padding dưới (8). */
  paddingBottom: number;

  // ── Hàng tiêu đề: [L] BTCUSDT · Vĩnh cửu · Cross 10X ▮▮▮▯ ─────
  /** chiều cao hàng tiêu đề (30). */
  headHeight: number;
  /** khoảng cách badge → symbol (8). */
  badgeGap: number;
  /** khoảng cách symbol → tag đầu tiên (6). */
  symbolGap: number;
  /** khoảng cách giữa các tag "Vĩnh cửu" / "Cross 10X" (4). */
  tagGap: number;
  /** khoảng cách tag cuối → 4 vạch risk (6). */
  barsGapFromTag: number;
  /** ô vuông L/S (26 = 26×26). */
  badgeSize: number;
  /** bo góc ô L/S (4). */
  badgeRadius: number;
  /** độ đậm chữ L/S (700). */
  badgeWeight: number;
  /** cỡ chữ L/S trong ô (16). */
  badgeFontSize: number;
  /** màu chữ L/S ("#fff"). */
  badgeTextColor: string;
  /** dịch ngang chữ L/S, px CSS (âm = sang trái). */
  badgeTextOffsetX: number;
  /** dịch dọc chữ L/S, px CSS (âm = lên trên). */
  badgeTextOffsetY: number;
  /** màu nền badge LONG; null = theme.buyColor. */
  badgeLongColor: string | null;
  /** màu nền badge SHORT; null = theme.sellColor. */
  badgeShortColor: string | null;
  /** cỡ mã sản phẩm "BTCUSDT" (22). */
  symbolFontSize: number;
  /** độ đậm mã sản phẩm (600). */
  symbolWeight: number;
  /** màu mã sản phẩm; null = theme.primaryText. */
  symbolColor: string | null;
  /** nền tag ("transparent" = trong suốt như Binance). */
  tagBackground: string;
  /** viền tag ("1px solid #474d57"; "none" = bỏ viền). */
  tagBorder: string;
  /** bo góc tag (4). */
  tagRadius: number;
  /** độ đậm chữ trong tag (500). */
  tagWeight: number;
  /** cỡ chữ trong tag (14). */
  tagFontSize: number;
  /** chiều cao cố định của tag; null = tự co theo chữ + padding. */
  tagHeight: number | null;
  /** màu chữ trong tag; null = theme.primaryText. */
  tagTextColor: string | null;
  /** padding trên/dưới tag (3). */
  tagPadY: number;
  /** padding trái tag (4). */
  tagPadLeft: number;
  /** padding phải tag (8). */
  tagPadX: number;
  /** tag tên account dài nhất (150, tràn sẽ hiển thị ...). */
  accountTagMaxWidth: number;

  // ── 4 vạch risk bên phải tiêu đề ───────────────────────────────
  /** chiều cao vạch (14). */
  barsHeight: number;
  /** khoảng cách giữa các vạch (2). */
  barsGap: number;
  /** bề dày mỗi vạch (2). */
  barWidth: number;
  /** bo góc vạch (1). */
  barRadius: number;
  /** độ nghiêng vạch, deg (-6 = nghiêng trái). */
  barSkew: number;
  /** màu vạch đang bật; null = theme.positivePnl. */
  barOnColor: string | null;
  /** màu vạch đã tắt (#474d57). */
  barOffColor: string;
  /** đường kính chấm tròn dưới 4 vạch, px (3). */
  barDotSize: number;
  /** khoảng cách vạch dưới → chấm tròn (2). */
  barDotGap: number;
  /** màu chấm tròn; null = màu vạch đang bật. */
  barDotColor: string | null;
  /** màu chấm của vạch tắt; null = barOffColor. */
  barDotOffColor: string | null;

  // ── Icon ────────────────────────────────────────────────────────
  /** icon share cạnh nhãn PNL (19). */
  iconSize: number;
  /** icon ⇄ cạnh "Kích thước" (24). */
  swapIconSize: number;
  /** khoảng cách giữa 2 thân mũi icon swap, đơn vị viewBox (4; trước đây 7).
   *  Giữ `swapLineGap/2 + swapWingLen ≤ 11` để cánh không chạm mép 24px. */
  swapLineGap: number;
  /** độ dài cánh chéo mỗi đầu mũi icon swap, đơn vị viewBox (4). */
  swapWingLen: number;
  /** khoảng cách icon swap với nhãn "Kích thước", px (6 = bằng labelRowGap cũ). */
  swapIconGap: number;
  /** độ dày nét icon (1.7). */
  iconStrokeWidth: number;
  /** màu nét icon; null = theme.secondaryText. */
  iconColor: string | null;

  // ── Hàng số liệu 3 cột (Kích thước / Margin / Tỉ lệ ký quỹ…) ───
  /** chia cột hàng 3 ô ("1fr 1fr 1fr"). */
  rowColumns: string;
  /** chia cột hàng PNL/ROI ("1fr auto"). */
  rowTwoColumns: string;
  /** khoảng cách trên mỗi hàng (0). */
  rowMarginTop: number;
  /** khoảng cách cột trong 1 hàng (4). */
  rowGap: number;
  /** khoảng cách icon với nhãn (6). */
  labelRowGap: number;
  /** độ dày gạch dưới nhãn, px (1). */
  labelLineThickness: number;
  /** độ dài 1 nét gạch, px (2). */
  labelLineDash: number;
  /** khoảng hở giữa 2 nét, px (1) — period = dash + gap: chỉnh 2 số này. */
  labelLineGap: number;
  /** màu gạch; null = #474d57. */
  labelLineColor: string | null;
  /** khoảng cách nhãn với gạch (1). */
  labelPaddingBottom: number;
  /** độ đậm nhãn (400). */
  labelWeight: number;
  /** cỡ nhãn; null = lấy STATS_CARD_THEME.lineFontSize (17). */
  labelFontSize: number | null;
  /** màu nhãn; null = theme.secondaryText. */
  labelColor: string | null;
  /** cỡ số dòng Kích thước/Margin/Giá… (18). */
  valueFontSize: number;
  /** độ đậm số (500). */
  valueWeight: number;
  /** màu số; null = theme.primaryText. */
  valueColor: string | null;
  /** khoảng cách nhãn → số (4). */
  valueMarginTop: number;
  /** giãn dòng của số (1.25). */
  valueLineHeight: number;
  /** letter-spacing âm cho số thường, px (0 = tắt). */
  valueTracking: number;
  /** letter-spacing âm cho mã/nhãn/số lớn, px (0.2 → -0.2px). */
  tightTracking: number;
  /** dịch dấu phẩy phân cách nghìn, px CSS (dương = sang phải). */
  numberSepShift: number;

  // ── Số lớn PNL / ROI ───────────────────────────────────────────
  /** cỡ số PNL/ROI; null = lấy STATS_CARD_THEME.pnlFontSize (18). */
  bigFontSize: number | null;
  /** độ đậm số PNL/ROI (600). */
  bigWeight: number;
  /** khoảng cách nhãn → số PNL/ROI (4). */
  bigMarginTop: number;
  /** màu PNL dương; null = theme.positivePnl. */
  pnlUpColor: string | null;
  /** màu PNL âm; null = theme.negativePnl. */
  pnlDownColor: string | null;
  /** màu PNL = 0; null = theme.zeroPnl. */
  pnlZeroColor: string | null;

  // ── Chữ hiển thị (đổi nhãn trực tiếp) ─────────────────────────
  labels: {
    pnl: string;
    roi: string;
    notional: string;
    margin: string;
    marginRatio: string;
    entry: string;
    mark: string;
    liq: string;
  };
}

const TUNING: StatsTuning = {
  // ── Nền & khung card ──
  bodyBackground: null, // null = theme.background
  cardBackground: null, // null = theme.background
  cardRadius: 0,
  cardWeight: 400,
  cardJustify: "space-between",
  fontVariantNumeric: "tabular-nums",
  paddingX: null, // null = theme.rightPadding
  paddingTop: 12,
  paddingBottom: 8,

  // ── Hàng tiêu đề ──
  headHeight: 30,
  badgeGap: 8,
  symbolGap: 4,
  tagGap: 3,
  barsGapFromTag: 6,
  badgeSize: 20.5,
  badgeRadius: 2.5,
  badgeWeight: 500,
  badgeFontSize: 15,
  badgeTextColor: "#fff",
  badgeTextOffsetX: -0.25,
  badgeTextOffsetY: -0.875,
  badgeLongColor: null, // null = theme.buyColor
  badgeShortColor: null, // null = theme.sellColor
  symbolFontSize: 20,
  symbolWeight: 600,
  symbolColor: null, // null = theme.primaryText
  tagBackground: "#29313e",
  tagBorder: "0.5px solid #303942",
  tagRadius: 2.5,
  tagWeight: 350,
  tagFontSize: 13.5,
  tagHeight: 20, // null = tự co; ví dụ 18 = cao cố định 18px
  tagTextColor: null, // null = theme.primaryText
  tagPadY: 1,
  tagPadLeft: 7,
  tagPadX: 7,
  accountTagMaxWidth: 150,

  // ── 4 vạch risk ──
  barsHeight: 12,
  barsGap: 2,
  barWidth: 1,
  barRadius: 1,
  barSkew: 0,
  barOnColor: null, // null = theme.positivePnl
  barOffColor: "#474d57",
  barDotSize: 2,
  barDotGap: 1,
  barDotColor: null, // null = màu vạch đang bật
  barDotOffColor: null, // null = barOffColor

  // ── Icon ──
  iconSize: 18,
  swapIconSize: 22,
  swapLineGap: 5, // 4 = thân mũi sát hơn (cũ: 7)
  swapWingLen: 4,
  swapIconGap: 4.5, // chỉ ô Kích thước; PNL/share icon vẫn theo labelRowGap
  iconStrokeWidth: 1.7,
  iconColor: null, // null = theme.secondaryText

  // ── Hàng số liệu 3 cột ──
  rowColumns: "1fr 1fr 1fr",
  rowTwoColumns: "1fr auto",
  rowMarginTop: 0,
  rowGap: 4,
  labelRowGap: 6,
  labelLineThickness: 1,
  labelLineDash: 2,
  labelLineGap: 1,
  labelLineColor: null, // null = #474d57
  labelPaddingBottom: 1,
  labelWeight: 400,
  labelFontSize: 15, // null = theme.lineFontSize
  labelColor: null, // null = theme.secondaryText
  valueFontSize: 17.5,
  valueWeight: 400,
  valueColor: null, // null = theme.primaryText
  valueMarginTop: 4,
  valueLineHeight: 1.25,
  valueTracking: 0,
  tightTracking: 0.2,
  numberSepShift: 0.25,

  // ── Số lớn PNL/ROI ──
  bigFontSize: null, // null = theme.pnlFontSize
  bigWeight: 600,
  bigMarginTop: 3,
  pnlUpColor: null, // null = theme.positivePnl
  pnlDownColor: null, // null = theme.negativePnl
  pnlZeroColor: null, // null = theme.zeroPnl

  // ── Chữ hiển thị ──
  labels: {
    pnl: "PNL (USDT)",
    roi: "ROI",
    notional: "Kích thước (USDT)",
    margin: "Margin (USDT)",
    marginRatio: "Tỉ lệ ký quỹ",
    entry: "Giá vào lệnh (USDT)",
    mark: "Giá đánh dấu (USDT)",
    liq: "Giá thanh lý (USDT)",
  },
};

/** Bảng thông số đang dùng — export để test/preview bám theo chỉnh tay. */
export const STATS_CARD_TUNING = TUNING;

/**
 * Vietnamese position-stats card (kind `position-stats`), a 1:1 port of the
 * Binance mobile position panel. Authored 1:1 in CSS px (520×240); labels are
 * larger than the numbers, and the rows spread with flex so the layout never
 * overflows the fixed height. The renderer multiplies by `theme.scale` (2×),
 * so the PNG is 1040×480.
 */
export function renderStatsHtml(model: StatsCardViewModel, theme: CardTheme): string {
  const scale = theme.scale ?? 1;
  const width = theme.width / scale;
  const height = theme.height / scale;
  const px = (value: number): string => `${value}px`;

  const paddingX = TUNING.paddingX ?? theme.rightPadding;
  const labelFontSize = TUNING.labelFontSize ?? theme.lineFontSize;
  const bigFontSize = TUNING.bigFontSize ?? theme.pnlFontSize;
  const bodyBackground = TUNING.bodyBackground ?? theme.background;
  const cardBackground = TUNING.cardBackground ?? theme.background;
  const symbolColor = TUNING.symbolColor ?? theme.primaryText;
  const tagTextColor = TUNING.tagTextColor ?? theme.primaryText;
  const barOnColor = TUNING.barOnColor ?? theme.positivePnl;
  const barDotColor = TUNING.barDotColor ?? barOnColor;
  const barDotOffColor = TUNING.barDotOffColor ?? TUNING.barOffColor;
  const iconColor = TUNING.iconColor ?? theme.secondaryText;
  const labelColor = TUNING.labelColor ?? theme.secondaryText;
  // Underline: a gradient, not a border — Chromium's dashed period is fixed,
  // a gradient lets TUNING control dash/gap while the width stays the label's.
  const labelLineColor = TUNING.labelLineColor ?? "#474d57";
  const labelLinePeriod = TUNING.labelLineDash + TUNING.labelLineGap;
  const valueColor = TUNING.valueColor ?? theme.primaryText;
  const pnlUpColor = TUNING.pnlUpColor ?? theme.positivePnl;
  const pnlDownColor = TUNING.pnlDownColor ?? theme.negativePnl;
  const pnlZeroColor = TUNING.pnlZeroColor ?? theme.zeroPnl;
  const badgeLongColor = TUNING.badgeLongColor ?? theme.buyColor;
  const badgeShortColor = TUNING.badgeShortColor ?? theme.sellColor;
  const tagHeightCss =
    TUNING.tagHeight === null
      ? ""
      : `height:${px(TUNING.tagHeight)};display:inline-flex;align-items:center;`;
  const valueTrackingCss =
    TUNING.valueTracking > 0 ? `letter-spacing:-${px(TUNING.valueTracking)};` : "";
  const cardRadiusCss = TUNING.cardRadius > 0 ? `border-radius:${px(TUNING.cardRadius)};` : "";

  // Risk indicator: one SVG per column so bar + dot share the exact same
  // centre X (no separate CSS layers → no 1px raster snap drift).
  const barColWidth = Math.max(TUNING.barWidth, TUNING.barDotSize);
  const barColHeight = TUNING.barsHeight + TUNING.barDotGap + TUNING.barDotSize;
  const barRectX = (barColWidth - TUNING.barWidth) / 2;
  const barCenterX = barColWidth / 2;
  const dotCenterY = TUNING.barsHeight + TUNING.barDotGap + TUNING.barDotSize / 2;
  const num = (value: number): string => String(Number(value.toFixed(3)));
  const barSkewCss =
    TUNING.barSkew !== 0
      ? ` transform="translate(${num(barCenterX)} ${num(TUNING.barsHeight / 2)}) skewX(${num(TUNING.barSkew)}) translate(${num(-barCenterX)} ${num(-TUNING.barsHeight / 2)})"`
      : "";
  const riskBar = (on: boolean): string =>
    `<svg class="bar-item${on ? "" : " off"}" width="${num(barColWidth)}" height="${num(barColHeight)}" viewBox="0 0 ${num(barColWidth)} ${num(barColHeight)}" aria-hidden="true">` +
    `<rect x="${num(barRectX)}" y="0" width="${num(TUNING.barWidth)}" height="${num(TUNING.barsHeight)}" rx="${num(TUNING.barRadius)}" fill="${on ? barOnColor : TUNING.barOffColor}"${barSkewCss}/>` +
    `<circle cx="${num(barCenterX)}" cy="${num(dotCenterY)}" r="${num(TUNING.barDotSize / 2)}" fill="${on ? barDotColor : barDotOffColor}"/></svg>`;
  const riskBars = riskBar(true) + riskBar(true) + riskBar(true) + riskBar(false);


  const baseSymbol = escapeHtml(model.symbol);
  const symbol = /USDT$/i.test(model.symbol) ? baseSymbol : `${baseSymbol}USDT`;
  const accountTag = '<span class="tag acc">Vĩnh cửu</span>';
  const pnlClass =
    model.pnlColor === theme.positivePnl
      ? "up"
      : model.pnlColor === theme.negativePnl
        ? "down"
        : "zero";
  const shareIcon = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="18.5" r="2.8"/><path d="M8.5 10.7l7-3.9M8.5 13.3l7 3.9"/></svg>`;
  // Swap arrows: heads reversed (top ←, bottom →), one wing per tip, wings
  // flaring OUT of the gap (top wing up, bottom wing down). Geometry comes
  // from TUNING: bodies `swapLineGap` apart, centred at 12 in the 24 box.
  const swapTopY = 12 - TUNING.swapLineGap / 2;
  const swapBotY = 12 + TUNING.swapLineGap / 2;
  const swapWing = TUNING.swapWingLen;
  const swapIcon = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:${px(TUNING.swapIconSize)};height:${px(TUNING.swapIconSize)}"><path d="M20 ${num(swapTopY)}H4l${num(swapWing)} -${num(swapWing)}M4 ${num(swapBotY)}H20l-${num(swapWing)} ${num(swapWing)}"/></svg>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${statsFontFaceCss()}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${width}px;height:${height}px;background:${bodyBackground};color:${theme.primaryText};font-family:${theme.fontFamily};font-variant-numeric:${TUNING.fontVariantNumeric};overflow:hidden}
.card{width:100%;height:100%;background:${cardBackground};${cardRadiusCss}padding:${px(TUNING.paddingTop)} ${px(paddingX)} ${px(TUNING.paddingBottom)};font-weight:${TUNING.cardWeight};display:flex;flex-direction:column;justify-content:${TUNING.cardJustify}}
.head{display:flex;align-items:center;gap:0;flex-wrap:nowrap;white-space:nowrap;height:${px(TUNING.headHeight)};overflow:hidden}
.badge{width:${px(TUNING.badgeSize)};height:${px(TUNING.badgeSize)};border-radius:${px(TUNING.badgeRadius)};display:grid;place-items:center;font-weight:${TUNING.badgeWeight};font-size:${px(TUNING.badgeFontSize)};color:${TUNING.badgeTextColor};flex-shrink:0;margin-right:${px(TUNING.badgeGap)}}
.badge-txt{display:inline-block;transform:translate(${px(TUNING.badgeTextOffsetX)},${px(TUNING.badgeTextOffsetY)})}
.badge.long{background:${badgeLongColor}}
.badge.short{background:${badgeShortColor}}
.sym{font-size:${px(TUNING.symbolFontSize)};font-weight:${TUNING.symbolWeight};color:${symbolColor};letter-spacing:-${px(TUNING.tightTracking)};margin-right:${px(TUNING.symbolGap)}}
.tag{background:${TUNING.tagBackground};border:${TUNING.tagBorder};border-radius:${px(TUNING.tagRadius)};padding:${px(TUNING.tagPadY)} ${px(TUNING.tagPadX)} ${px(TUNING.tagPadY)} ${px(TUNING.tagPadLeft)};${tagHeightCss}font-size:${px(TUNING.tagFontSize)};font-weight:${TUNING.tagWeight};color:${tagTextColor};white-space:nowrap;flex-shrink:0;margin-right:${px(TUNING.tagGap)}}
.tag.acc{max-width:${px(TUNING.accountTagMaxWidth)};overflow:hidden;text-overflow:ellipsis}
.bars{display:inline-flex;gap:${px(TUNING.barsGap)};align-items:flex-end;margin-left:${px(TUNING.barsGapFromTag)};flex-shrink:0}
.bar-item{display:block;flex-shrink:0}
.lrow{display:flex;align-items:center;gap:${px(TUNING.labelRowGap)}}
.lrow.swap{gap:${px(TUNING.swapIconGap)}}
.ico{width:${px(TUNING.iconSize)};height:${px(TUNING.iconSize)};stroke:${iconColor};fill:none;stroke-width:${TUNING.iconStrokeWidth};stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.ico circle{fill:none}
.row{display:grid;grid-template-columns:${TUNING.rowColumns};gap:${px(TUNING.rowGap)};margin-top:${px(TUNING.rowMarginTop)}}
.row.two{grid-template-columns:${TUNING.rowTwoColumns}}
.lbl{font-size:${px(labelFontSize)};font-weight:${TUNING.labelWeight};color:${labelColor};display:inline-block;background-image:repeating-linear-gradient(to right,${labelLineColor} 0 ${TUNING.labelLineDash}px,transparent ${TUNING.labelLineDash}px,transparent ${labelLinePeriod}px);background-repeat:no-repeat;background-position:left bottom;background-size:100% ${TUNING.labelLineThickness}px;padding-bottom:${px(TUNING.labelPaddingBottom)};white-space:nowrap;letter-spacing:-${px(TUNING.tightTracking)}}
.lbl.plain{border:0;background-image:none}
.val{font-size:${px(TUNING.valueFontSize)};font-weight:${TUNING.valueWeight};color:${valueColor};${valueTrackingCss}margin-top:${px(TUNING.valueMarginTop)};white-space:nowrap;line-height:${TUNING.valueLineHeight}}
.big{font-size:${px(bigFontSize)};font-weight:${TUNING.bigWeight};margin-top:${px(TUNING.bigMarginTop)};letter-spacing:-${px(TUNING.tightTracking)};white-space:nowrap;line-height:${TUNING.valueLineHeight}}
.num-sep{margin-left:${px(TUNING.numberSepShift)};margin-right:${px(-TUNING.numberSepShift)}}
.r{text-align:right}
.up{color:${pnlUpColor}}
.down{color:${pnlDownColor}}
.zero{color:${pnlZeroColor}}
</style></head><body>
<div class="card">
<div class="head">
<span class="badge ${model.directionBadge === "L" ? "long" : "short"}"><span class="badge-txt">${model.directionBadge}</span></span>
<span class="sym">${symbol}</span>
${accountTag}
<span class="tag">${escapeHtml(model.marginTypeText)}</span>
<span class="bars">${riskBars}</span>
</div>
<div class="row two">
<div>
<div class="lrow"><span class="lbl">${TUNING.labels.pnl}</span>${shareIcon}</div>
<div class="big ${pnlClass}">${numberHtml(model.pnlText)}</div>
</div>
<div class="r">
<span class="lbl">${TUNING.labels.roi}</span>
<div class="big ${pnlClass}">${numberHtml(model.roiText)}</div>
</div>
</div>
<div class="row">
<div><div class="lrow swap"><span class="lbl plain">${TUNING.labels.notional}</span>${swapIcon}</div><div class="val">${numberHtml(model.notionalText)}</div></div>
<div><span class="lbl plain">${TUNING.labels.margin}</span><div class="val">${numberHtml(model.marginText)}</div></div>
<div class="r"><span class="lbl">${TUNING.labels.marginRatio}</span><div class="val up">${numberHtml(model.marginRatioText)}</div></div>
</div>
<div class="row">
<div><span class="lbl">${TUNING.labels.entry}</span><div class="val">${numberHtml(model.entryText)}</div></div>
<div><span class="lbl plain">${TUNING.labels.mark}</span><div class="val">${numberHtml(model.markText)}</div></div>
<div class="r"><span class="lbl">${TUNING.labels.liq}</span><div class="val">${numberHtml(model.liqText)}</div></div>
</div>
</div>
</body></html>`;
}
