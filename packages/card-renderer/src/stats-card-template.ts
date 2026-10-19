import { CardTheme } from "./card-config";
import { StatsCardViewModel } from "./stats-view-model";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface CellOptions {
  dotted?: boolean;
  right?: boolean;
  valueClass?: string;
  cellClass?: string;
  icon?: string;
}

function statCell(label: string, value: string, opts: CellOptions = {}): string {
  const labelClass = `label${opts.dotted ? " dotted" : ""}`;
  const labelHtml = `<div class="${labelClass}">${escapeHtml(label)}${opts.icon ?? ""}</div>`;
  const valueClass = `value${opts.valueClass ? ` ${opts.valueClass}` : ""}`;
  const cellClasses = [opts.right ? "right" : "", opts.cellClass ?? ""].filter(Boolean).join(" ");
  return `<div${cellClasses ? ` class="${cellClasses}"` : ""}>
${labelHtml}
<div class="${valueClass}">${escapeHtml(value)}</div>
</div>`;
}

/** Vietnamese position-stats card (kind `position-stats`), theme.width×theme.height. */
export function renderStatsHtml(model: StatsCardViewModel, theme: CardTheme): string {
  const baseSymbol = escapeHtml(model.symbol);
  const symbol = /USDT$/i.test(model.symbol) ? baseSymbol : `${baseSymbol}USDT`;
  const accountTag = model.accountName
    ? `<div class="tag">${escapeHtml(model.accountName)}</div>`
    : "";
  const gray = theme.secondaryText;
  const positive = theme.positivePnl;
  const shareIcon = `<svg class="share-ico" viewBox="0 0 36 36" aria-hidden="true"><circle cx="8" cy="18" r="4"/><circle cx="27" cy="7" r="4"/><circle cx="27" cy="29" r="4"/><path d="M12 16 L23 9 M12 20 L23 27"/></svg>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;padding:25px ${theme.rightPadding}px 15px;width:${theme.width}px;height:${theme.height}px;background:${theme.background};color:${theme.primaryText};font-family:${theme.fontFamily};overflow:hidden}
.header{display:flex;align-items:center;gap:10px;height:58px;white-space:nowrap}
.side{width:52px;height:52px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:7px;background:${model.directionColor};color:#FFFFFF;font-size:32px;font-weight:700}
.symbol{margin-left:9px;font-size:44px;font-weight:600;letter-spacing:-1.2px}
.tag{padding:6px 14px;background:#262C36;border:1px solid #414b58;border-radius:7px;color:#d5dae2;font-size:30px;line-height:1.2}
.indicator{display:flex;align-items:center;gap:6px;margin-left:14px}
.indicator i{display:block;width:3px;height:28px;border-radius:1px}
.indicator .green{background:${positive}}
.indicator .gray{background:#697482}
.pnl-row{display:flex;justify-content:space-between;margin-top:30px}
.label{color:${gray};font-size:${theme.lineFontSize}px;font-weight:400;line-height:1.2;white-space:nowrap}
.share-label{display:flex;align-items:center;gap:18px}
.share-label svg.share-ico{width:38px;height:38px;fill:none;stroke:${gray};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.swap-ico{width:0.95em;height:0.95em;flex-shrink:0;margin-left:8px;fill:none;stroke:${gray};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pnl{margin-top:10px;color:${model.pnlColor};font-size:${theme.pnlFontSize}px;font-weight:700;line-height:1;letter-spacing:-0.8px;font-variant-numeric:tabular-nums}
.right{text-align:right}
.dotted{display:inline-block;border-bottom:2px dotted #687381;padding-bottom:4px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:32px}
.metrics{margin-top:30px}
.prices{margin-top:25px}
.value{margin-top:12px;font-size:40px;font-weight:400;line-height:1.05;white-space:nowrap;font-variant-numeric:tabular-nums}
.prices .value{margin-top:8px}
.ratio .value{font-size:32px}
.green-text{color:${positive}}
</style></head><body>
<div class="header">
<div class="side">${model.directionBadge}</div>
<div class="symbol">${symbol}</div>
${accountTag}
<div class="tag">${escapeHtml(model.marginTypeText)}</div>
<div class="indicator"><i class="green"></i><i class="green"></i><i class="gray"></i><i class="gray"></i></div>
</div>
<div class="pnl-row">
<div>
<div class="label share-label">PNL (USDT)${shareIcon}</div>
<div class="pnl">${escapeHtml(model.pnlText)}</div>
</div>
<div class="right">
<div class="label dotted">ROI</div>
<div class="pnl">${escapeHtml(model.roiText)}</div>
</div>
</div>
<div class="grid metrics">
  ${statCell("Kích thước (USDT)", model.notionalText, { icon: `<svg class="swap-ico" viewBox="0 0 24 24" fill="none" stroke="${gray}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4l-4 4 4 4"/><path d="M4 8h16"/><path d="M16 20l4-4-4-4"/><path d="M20 16H4"/></svg>` })}
${statCell("Margin (USDT)", model.marginText)}
${statCell("Tỉ lệ ký quỹ", model.marginRatioText, { dotted: true, right: true, valueClass: "green-text", cellClass: "ratio" })}
</div>
<div class="grid prices">
${statCell("Giá vào lệnh (USDT)", model.entryText, { dotted: true })}
${statCell("Giá đánh dấu (USDT)", model.markText, { dotted: true })}
${statCell("Giá thanh lý (USDT)", model.liqText, { dotted: true, right: true })}
</div>
</body></html>`;
}
