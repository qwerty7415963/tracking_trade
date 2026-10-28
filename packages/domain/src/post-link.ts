/**
 * Link to the exact source post. Prefers a stored URL; otherwise builds
 * https://t.me/{channel}/{id} for Telegram numeric messages (ingestion
 * never stores it, so this also covers old rows). Returns null when no
 * link can be built (X sources, non-numeric ids, missing handle).
 */
export function buildPostLink(
  platform: string,
  sourceExternalId: string,
  externalMessageId: string | null | undefined,
  sourceUrl?: string | null,
): string | null {
  if (sourceUrl && sourceUrl.trim()) return sourceUrl;
  if (platform !== "TELEGRAM" || !externalMessageId) return null;
  if (!/^\d+$/.test(externalMessageId)) return null;
  const handle = sourceExternalId.trim().replace(/^@+/, "");
  if (!handle || /^-?\d+$/.test(handle)) return null;
  return `https://t.me/${handle}/${externalMessageId}`;
}
