// Decode a public transaction fixture. No wallet, keys, signing, or networking.
#include "currency_core/currency_format_utils.h"
#include "currency_core/currency_format_utils_transactions.h"
#include <iostream>
#include <string>
int main() {
  std::string hex, blob;
  if (!(std::cin >> hex) || hex.size() % 2 != 0) return 2;
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < hex.size(); i += 2) {
    const int a = nibble(hex[i]), b = nibble(hex[i + 1]);
    if (a < 0 || b < 0) return 2;
    blob.push_back(static_cast<char>((a << 4) | b));
  }
  currency::transaction tx;
  crypto::hash hash{};
  const bool parsed = currency::parse_and_validate_tx_from_blob(blob, tx, hash);
  std::cout << "{\"parsed\":" << (parsed ? "true" : "false")
            << ",\"version\":" << static_cast<unsigned>(tx.version)
            << ",\"bytes\":" << blob.size()
            << ",\"txid\":\"" << (parsed ? epee::string_tools::pod_to_hex(hash) : "") << "\"}\n";
  return 0;
}
