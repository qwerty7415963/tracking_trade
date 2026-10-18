import { CardTheme } from "./card-config";
import { StatsCardViewModel } from "./stats-view-model";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statCell(label: string, value: string, valueColor?: string): string {
  const color = valueColor ? ` style="color:${valueColor}"` : "";
  return `<div class="cell">
<div class="label">${escapeHtml(label)}</div>
<div class="value"${color}>${escapeHtml(value)}</div>
</div>`;
}

/** Vietnamese position-stats card (kind `position-stats`), 1280×theme.height. */
export function renderStatsHtml(model: StatsCardViewModel, theme: CardTheme): string {
  const symbol = escapeHtml(model.symbol);
  const accountChip = model.accountName
    ? `<span class="chip">${escapeHtml(model.accountName)}</span>`
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${theme.width}px;height:${theme.height}px;background:${theme.background};color:${theme.primaryText};font-family:${theme.fontFamily};display:flex;flex-direction:column;padding:36px ${theme.rightPadding}px 32px ${theme.leftPadding}px}
.header{display:flex;align-items:center;gap:16px}
.badge{width:56px;height:56px;border-radius:10px;background:${model.directionColor};color:#FFFFFF;font-size:34px;font-weight:700;display:flex;align-items:center;justify-content:center}
.symbol{font-size:44px;font-weight:700;letter-spacing:.5px}
.chip{background:#262B33;color:#C9CED6;font-size:26px;border-radius:8px;padding:8px 16px}
.headline{display:flex;justify-content:space-between;align-items:flex-start;margin-top:26px}
.headline .label{font-size:${theme.lineFontSize}px;color:${theme.secondaryText};border-bottom:1px dashed #3A404A;padding-bottom:6px}
.headline .big{font-size:${theme.pnlFontSize}px;font-weight:700;margin-top:10px}
.headline .right{text-align:right}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:32px;margin-top:24px}
.cell .label{font-size:${theme.lineFontSize}px;color:${theme.secondaryText};border-bottom:1px dashed #3A404A;padding-bottom:6px;white-space:nowrap}
.cell .value{font-size:40px;font-weight:600;margin-top:10px}
</style></head><body>
<div class="header">
<div class="badge">${model.directionBadge}</div>
<div class="symbol">${symbol}</div>
${accountChip}
<span class="chip">${escapeHtml(model.marginTypeText)}</span>
</div>
<div class="headline">
<div>
<div class="label">PNL (USDT)</div>
<div class="big" style="color:${model.pnlColor}">${escapeHtml(model.pnlText)}</div>
</div>
<div class="right">
<div class="label">ROI</div>
<div class="big" style="color:${model.pnlColor}">${escapeHtml(model.roiText)}</div>
</div>
</div>
<div class="grid">
${statCell("Kích thước (USDT)", model.notionalText)}
${statCell("Margin (USDT)", model.marginText)}
${statCell("Tỉ lệ ký quỹ", model.marginRatioText, model.marginRatioText === "--" ? theme.zeroPnl : theme.positivePnl)}
</div>
<div class="grid">
${statCell("Giá vào lệnh (USDT)", model.entryText)}
${statCell("Giá đánh dấu (USDT)", model.markText)}
${statCell("Giá thanh lý (USDT)", model.liqText, model.liqText === "--" ? theme.zeroPnl : theme.primaryText)}
</div>
</body></html>`;
}
