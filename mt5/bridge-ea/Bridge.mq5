//+------------------------------------------------------------------+
//| Bridge.mq5 — MT5 bridge EA skeleton (Phase 4, UNVERIFIED)         |
//| Requires the MT5 Docker/native spike before live use.             |
//| Flow: poll backend for commands -> execute -> report fills +      |
//| heartbeat. Backend is the journal owner; EA never invents fills. |
//+------------------------------------------------------------------+
#property copyright "tracking-auto"
#property version   "0.1.0"

input string BackendUrl = "http://backend:3000";
input string BridgeApiKey = "";
input long   AccountId     = 0;
input int    PollSeconds   = 5;

string LastHeartbeat = "";

//--- Poll pending commands from the backend (outbound-authenticated).
void PollCommands()
{
   // TODO(spike): WebRequest() to {BackendUrl}/bridge/commands?account=...
   // with Authorization header; allow-list BackendUrl in Terminal options.
   // Parse command JSON, dispatch by command_type:
   //   OPEN / MODIFY_SLTP / PARTIAL_CLOSE / CLOSE_POSITION / CLOSE_ALL_TARGET
   // Execute via CTrade, then POST the BridgeResponse contract
   // (ACCEPTED -> IN_PROGRESS -> CONFIRMED / REJECTED / UNKNOWN).
   // Idempotency: skip commands already present in the local journal file.
}

//--- Append every command outcome to the local journal (crash recovery).
void JournalAppend(const string &line)
{
   int handle = FileOpen("bridge-journal.log", FILE_READ | FILE_WRITE | FILE_TXT);
   if(handle == INVALID_HANDLE)
      return;
   FileSeek(handle, 0, SEEK_END);
   FileWriteString(handle, TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS) + " " + line + "\n");
   FileClose(handle);
}

//--- Heartbeat: account/server/terminal status + open positions summary.
void SendHeartbeat()
{
   // TODO(spike): POST {BackendUrl}/bridge/heartbeat with
   // account, terminal build, balance/equity/margin, positions count.
   LastHeartbeat = TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS);
}

int OnInit()
{
   if(StringLen(BridgeApiKey) == 0)
   {
      Print("BridgeApiKey missing, EA disabled");
      return INIT_FAILED;
   }
   EventSetTimer(PollSeconds);
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
   // TODO(spike): map deal/order/position IDs into the pending command
   // response. Never report CONFIRMED without broker retcode + IDs.
   JournalAppend("trade-transaction type=" + IntegerToString(trans.type));
}
