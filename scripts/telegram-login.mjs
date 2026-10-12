// One-time helper: log in with the user account and print a StringSession.
// Run: node scripts/telegram-login.mjs
// Then paste the printed session into .env as TELEGRAM_SESSION_STRING.
// Requires TELEGRAM_API_ID + TELEGRAM_API_HASH in .env
import fs from "node:fs";
import readline from "node:readline";
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
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
await client.start({
  phoneNumber: () => ask("Phone (+country code): "),
  password: () => ask("2FA password (empty if none): "),
  phoneCode: () => ask("Login code: "),
  onError: (err) => console.error("login error:", err.message ?? err),
});

const me = await client.getMe();
console.log(`Logged in as: ${me.username ?? me.firstName} (id ${me.id})`);
console.log("--- COPY INTO .env AS TELEGRAM_SESSION_STRING ---");
console.log(client.session.save());
console.log("-------------------------------------------------");

await client.disconnect();
rl.close();
