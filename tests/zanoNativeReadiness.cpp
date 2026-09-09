#include "zano_native_readiness.hpp"
#include <cassert>
#include <iostream>

int main() {
  assert(!zano_native_scan_ready("2", "3839804", "3851867"));
  assert(!zano_native_scan_ready("2", "0", "3851867"));
  assert(!zano_native_scan_ready("2", "", ""));
  assert(!zano_native_scan_ready("2", "0", "0"));
  assert(!zano_native_scan_ready("1", "3851867", "3851867"));
  assert(!zano_native_scan_ready("2", "3851867x", "3851867"));
  assert(!zano_native_scan_ready("2", "18446744073709551616", "3851867"));
  assert(zano_native_scan_ready("2", "3851866", "3851867"));
  assert(zano_native_scan_ready("2", "3851867", "3851867"));
  assert(zano_native_scan_ready("2", "3851868", "3851867"));
  assert(!zano_native_scan_ready("2", "3851865", "3851867"));
  assert(zano_scanned_block_count(3851866) == 3851867);
  assert(zano_scanned_block_count(UINT64_MAX) == UINT64_MAX);
  std::cout << "13 Zano readiness cases passed\n";
}
