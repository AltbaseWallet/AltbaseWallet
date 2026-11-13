// Local protocol fixture. This is NOT a real cryptocurrency or signing engine.
#include "../../plugin-sdk/altbase_plugin.h"
#include <cstdlib>
#include <cstring>
#include <thread>
#include <chrono>
#include <string>
#ifndef FIXTURE_ID
#define FIXTURE_ID "fixture-native"
#endif
#ifndef FIXTURE_VERSION
#define FIXTURE_VERSION "1.0.0"
#endif
#ifndef FIXTURE_ABI
#define FIXTURE_ABI 1
#endif

static const char definition[] =
  "{\"schemaVersion\":1,\"abiVersion\":1,\"id\":\"" FIXTURE_ID
  "\",\"name\":\"Native Fixture Coin\",\"ticker\":\"TEST\",\"version\":\"" FIXTURE_VERSION
  "\",\"kind\":\"utxo\",\"networkId\":\"local-fixture\",\"decimals\":8,\"testOnly\":true,"
  "\"iconDataUrl\":\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzAiIGZpbGw9IiMyMmM1NWUiLz48cGF0aCBkPSJNMTggMjBoMjh2N0gzNnYyMGgtOFYyN0gxOHoiIGZpbGw9IndoaXRlIi8+PC9zdmc+\","
  "\"capabilities\":[\"derive\",\"variants\",\"validate\",\"estimateFee\",\"estimateMax\",\"send\",\"nodeRequest\",\"snapshot\"]}";
static std::string network(bool syncing = false) {
  return "{\"ok\":true,\"coin\":\"" FIXTURE_ID "\",\"chain\":\"local-fixture\",\"blocks\":100,\"headers\":"
    + std::string(syncing ? "200" : "100") + ",\"initialBlockDownload\":" + (syncing ? "true" : "false") + ",\"verificationProgress\":1}";
}
static const char balance[] = "{\"balance\":\"425000000\",\"balance_spendable\":\"425000000\",\"received\":\"425000000\",\"immature\":\"0\"}";
static char* ok(const std::string& value) {
  const std::string result = "{\"ok\":true,\"result\":" + value + "}";
  char* out = static_cast<char*>(std::malloc(result.size() + 1));
  if (out) std::memcpy(out, result.c_str(), result.size() + 1);
  return out;
}
static char* error() {
  const char text[] = "{\"ok\":false,\"error\":\"Fixture operation is unavailable\"}";
  char* out = static_cast<char*>(std::malloc(sizeof(text)));
  if (out) std::memcpy(out, text, sizeof(text));
  return out;
}
uint32_t ALTBASE_PLUGIN_CALL altbase_plugin_abi_version() { return FIXTURE_ABI; }
const char* ALTBASE_PLUGIN_CALL altbase_plugin_manifest() { return definition; }
void ALTBASE_PLUGIN_CALL altbase_plugin_free(char* response) { std::free(response); }
char* ALTBASE_PLUGIN_CALL altbase_plugin_request(const char* method, const char* params) {
  try {
    if (std::strstr(params, "testCrash")) std::abort();
    if (std::strstr(params, "testTimeout")) std::this_thread::sleep_for(std::chrono::seconds(30));
    if (std::strstr(params, "testError")) return error();
    if (!std::strcmp(method, "derive")) return ok("\"ALTBASE_FIXTURE_ADDRESS\"");
    if (!std::strcmp(method, "variants")) return ok("[{\"id\":\"account\",\"label\":\"TEST\",\"address\":\"ALTBASE_FIXTURE_ADDRESS\",\"scriptKind\":\"account\"}]");
    if (!std::strcmp(method, "validate")) return ok(std::strstr(params, "ALTBASE_FIXTURE_") ? "true" : "false");
    if (!std::strcmp(method, "estimateFee")) return ok("{\"satoshis\":50000,\"coin\":\"0.0005\",\"exact\":true}");
    if (!std::strcmp(method, "estimateMax")) return ok("{\"amountCoin\":\"4.2495\",\"feeCoin\":\"0.0005\",\"feeSatoshis\":50000,\"inputCount\":2}");
    if (!std::strcmp(method, "send")) return ok("{\"txid\":\"fixture-only-no-transaction-was-created\",\"amountCoin\":\"1\",\"feeCoin\":\"0.0005\"}");
    if (!std::strcmp(method, "snapshot")) {
      return ok(std::string("{\"coin\":\"" FIXTURE_ID "\",\"network\":") + network(std::strstr(params, "testSyncing"))
        + ",\"walletBalance\":" + balance + ",\"balances\":{\"ALTBASE_FIXTURE_ADDRESS\":" + balance + "},\"histories\":{\"ALTBASE_FIXTURE_ADDRESS\":{\"ok\":true,\"address\":\"ALTBASE_FIXTURE_ADDRESS\",\"txids\":[],\"transactions\":[],\"deltas\":[]}}}");
    }
    if (!std::strcmp(method, "nodeRequest")) {
      if (std::strstr(params, "/network")) return ok(network());
      if (std::strstr(params, "/address/balance")) return ok(std::string("{\"ok\":true,\"result\":") + balance + "}");
      if (std::strstr(params, "/address/mempool")) return ok("{\"ok\":true,\"address\":\"ALTBASE_FIXTURE_ADDRESS\",\"hasPendingOutgoing\":false,\"pending\":[]}");
      if (std::strstr(params, "/address/history")) return ok("{\"ok\":true,\"address\":\"ALTBASE_FIXTURE_ADDRESS\",\"txids\":[],\"transactions\":[],\"deltas\":[]}");
      if (std::strstr(params, "/address/validate")) return ok("{\"ok\":true,\"result\":{\"isvalid\":true}}");
    }
    return error();
  } catch (...) { return error(); }
}
