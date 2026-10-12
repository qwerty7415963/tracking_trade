// Live check: verify TELEGRAM_SESSION_STRING works (connect + getMe + read a channel).
// Run: node scripts/telegram-verify.mjs [@channel] [limit]
// Read-only: never sends, joins, or modifies anything.
import fs from "node:fs";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

function loadEnv(path = ".env") {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const apiId = Number(env.TELEGRAM_API_ID ?? "");
const apiHash = env.TELEGRAM_API_HASH ?? "";
const session = env.TELEGRAM_SESSION_STRING ?? "";
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) {
  console.error("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING in .env");
  process.exit(1);
}

const channel = process.argv[2];
const limit = Number(process.argv[3] ?? "3");

const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
  connectionRetries: 3,
});
try {
  await client.connect();
  const me = await client.getMe();
  console.log(`connected as: ${me.username ?? me.firstName} (id ${me.id})`);

  if (channel) {
    const messages = await client.getMessages(channel, { limit });
    console.log(`read ${messages.length} message(s) from ${channel}:`);
    for (const m of messages) {
      const preview = String(m.message ?? "").slice(0, 120).replace(/\n/g, " | ");
      console.log(`- id=${m.id} date=${m.date} text="${preview}"`);
    }
  }
  console.log("VERIFY OK");
} catch (err) {
  console.error("VERIFY FAILED:", err.errorMessage ?? err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.disconnect();
}
