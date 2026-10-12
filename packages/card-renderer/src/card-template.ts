import { CardTheme } from "./card-config";
import { CardViewModel } from "./card-types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderCardHtml(model: CardViewModel, theme: CardTheme): string {
  const symbol = escapeHtml(model.symbol);
  const volume = escapeHtml(model.volumeText);
  const price = escapeHtml(model.priceText);
  const pnl = escapeHtml(model.pnlText);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${theme.width}px;height:${theme.height}px;background:${theme.background};color:${theme.primaryText};font-family:${theme.fontFamily};display:flex;align-items:center;justify-content:space-between;padding:0 ${theme.rightPadding}px 0 ${theme.leftPadding}px}
.left{line-height:1.25}
.line1{font-size:${theme.lineFontSize}px;font-weight:600}
.line1 .sym{color:${theme.primaryText}}
.line1 .vol{color:${theme.primaryText};margin-left:18px}
.line2{font-size:${theme.lineFontSize}px;color:${theme.secondaryText}}
.pnl{font-size:${theme.pnlFontSize}px;font-weight:700;white-space:nowrap}
</style></head><body>
<div class="left">
<div class="line1"><span class="sym">${symbol}</span> <span style="color:${model.directionColor}">${model.directionText}</span><span class="vol">${volume}</span></div>
<div class="line2">${price}</div>
</div>
<div class="pnl" style="color:${model.pnlColor}">${pnl}</div>
</body></html>`;
}
