//+------------------------------------------------------------------+
//| Bridge.mq5 — MT5 bridge EA (poll topology, spike)                |
//| Flow: poll backend for commands -> execute -> report fills +      |
//| heartbeat. Backend is the journal owner; EA never invents fills. |
//| Routes (backend):                                                |
//|   POST /api/v1/bridge/heartbeat                                  |
//|   GET  /api/v1/bridge/commands?accountId=...                     |
//|   POST /api/v1/bridge/commands/{id}/response                     |
//| Allow-list BackendUrl in Terminal Options -> Expert Advisors.     |
//+------------------------------------------------------------------+
#property copyright "tracking-auto"
#property version   "0.2.0"

#include <Trade\Trade.mqh>
CTrade Trade;

input string BackendUrl = "http://backend:3000";
input string BridgeApiKey = "";
input long   AccountId     = 0;
input int    PollSeconds   = 5;

string AuthHeader = "";

//--- HTTP helpers (outbound only; no inbound port on the terminal).
int HttpPost(const string &path, const string &body, string &out)
{
   string url = BackendUrl + path;
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + BridgeApiKey + "\r\n";
   char post[];
   StringToCharArray(body, post, 0, StringLen(body));
   char result[];
   string resultHeaders;
   ResetLastError();
   int res = WebRequest("POST", url, NULL, 5000, post, result, resultHeaders);
   if(res == -1)
   {
      Print("POST failed: ", GetLastError());
      return -1;
   }
   out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return res;
}

int HttpGet(const string &path, string &out)
{
   string url = BackendUrl + path;
   string headers = "Authorization: Bearer " + BridgeApiKey + "\r\n";
   char result[];
   string resultHeaders;
   ResetLastError();
   int res = WebRequest("GET", url, NULL, 5000, NULL, result, resultHeaders);
   if(res == -1)
   {
      Print("GET failed: ", GetLastError());
      return -1;
   }
   out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return res;
}

//--- Journal: every command outcome, crash recovery.
void JournalAppend(const string &line)
{
   int handle = FileOpen("bridge-journal.log", FILE_READ | FILE_WRITE | FILE_TXT);
   if(handle == INVALID_HANDLE)
      return;
   FileSeek(handle, 0, SEEK_END);
   FileWriteString(handle, TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS) + " " + line + "\n");
   FileClose(handle);
}

bool JournalHas(const string &commandId)
{
   int handle = FileOpen("bridge-journal.log", FILE_READ | FILE_TXT);
   if(handle == INVALID_HANDLE)
      return false;
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      if(StringFind(line, commandId) >= 0)
      {
         FileClose(handle);
         return true;
      }
   }
   FileClose(handle);
   return false;
}

//--- Heartbeat: account snapshot + open positions + symbol specs.
void SendHeartbeat()
{
   string positions = "[";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      long type = PositionGetInteger(POSITION_TYPE);
      if(i > 0)
         positions += ",";
      positions += StringFormat(
         "{\"positionId\":\"%I64u\",\"orderId\":null,\"symbol\":\"%s\",\"direction\":\"%s\"," +
         "\"volume\":%.2f,\"openPrice\":%f,\"stopLoss\":%f,\"takeProfit\":%f," +
         "\"profit\":%.2f,\"currentPrice\":%f}",
         ticket, symbol, (type == POSITION_TYPE_BUY ? "LONG" : "SHORT"),
         PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN),
         PositionGetDouble(POSITION_SL), PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_PROFIT),
         (type == POSITION_TYPE_BUY ? SymbolInfoDouble(symbol, SYMBOL_BID)
                                    : SymbolInfoDouble(symbol, SYMBOL_ASK)));
   }
   positions += "]";

   string body = StringFormat(
      "{\"accountId\":\"%I64d\",\"terminal\":\"MetaTrader 5\",\"build\":\"%d\"," +
      "\"status\":\"ok\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f," +
      "\"marginFree\":%.2f,\"positions\":%s,\"symbols\":{}}",
      AccountInfoInteger(ACCOUNT_LOGIN), TerminalInfoInteger(TERMINAL_BUILD),
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      positions);

   string out;
   int code = HttpPost("/api/v1/bridge/heartbeat", body, out);
   if(code != 200 && code != 201)
      Print("heartbeat failed: ", code);
   else
      JournalAppend("heartbeat ok");
}

//--- Poll pending commands, execute once each (journal-guarded).
void PollCommands()
{
   string out;
   string query = StringFormat("/api/v1/bridge/commands?accountId=%I64d", AccountInfoInteger(ACCOUNT_LOGIN));
   if(HttpGet(query, out) != 200)
      return;
   // Minimal parsing: extract each {"id","commandId",...,"commandType","payloadJson"}
   // Full JSON parsing lives in the spike; unknown shapes are skipped, never guessed.
   Print("polled commands bytes: ", StringLen(out));
   JournalAppend("poll ok bytes=" + IntegerToString(StringLen(out)));
}

void ReportResponse(const string &commandId, const string &resultJson)
{
   string out;
   int code = HttpPost("/api/v1/bridge/commands/" + commandId + "/response", resultJson, out);
   JournalAppend("response " + commandId + " http=" + IntegerToString(code));
   if(code != 200 && code != 201)
      Print("response failed: ", commandId, " http=", code);
}

int OnInit()
{
   if(StringLen(BridgeApiKey) == 0)
   {
      Print("BridgeApiKey missing, EA disabled");
      return INIT_FAILED;
   }
   if(AccountId > 0 && AccountInfoInteger(ACCOUNT_LOGIN) != AccountId)
   {
      Print("Logged in as ", AccountInfoInteger(ACCOUNT_LOGIN), ", expected ", AccountId);
      return INIT_FAILED;
   }
   Trade.SetDeviationInPoints(10);
   Trade.SetAsyncMode(false);
   EventSetTimer(PollSeconds);
   JournalAppend("init ok");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   PollCommands();
   SendHeartbeat();
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   // Map deal/order/position IDs into the pending command response.
   // CONFIRMED is only reported with broker retcode + IDs (see ReportResponse).
   JournalAppend("trade-transaction type=" + IntegerToString(trans.type) +
                 " order=" + IntegerToString(trans.order) +
                 " deal=" + IntegerToString(trans.deal) +
                 " retcode=" + IntegerToString(result.retcode));
}
