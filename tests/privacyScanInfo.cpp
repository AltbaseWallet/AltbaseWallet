#include "../native/core/src/privacy_scan_info.hpp"
#include "../native/core/src/native_http.hpp"
#include <cassert>
#include <iostream>
#include <stdexcept>
int main() {
  using namespace altbase;
  unsigned calls = 0;
  const auto body = read_privacy_scan_info("https://fixture.invalid/api/v1", "zano", [&](const std::string& url, unsigned long timeout) {
    ++calls;
    assert(url == "https://fixture.invalid/api/v1/zano/privacy/scan-info");
    assert(timeout == 45000);
    if (timeout < 16300) throw std::runtime_error("fixture cold TLS timeout");
    return HttpResponse{200, "{\"blocks\":3851465}", {}};
  });
  assert(body == "{\"blocks\":3851465}" && calls == 1);
  const auto httpError = read_privacy_scan_info("https://fixture.invalid/api/v1", "epic", [](const auto&, auto) {return HttpResponse{503, "unavailable", {}};});
  assert(httpError == "server scan-info HTTP 503");
  const auto unavailable = read_privacy_scan_info("https://fixture.invalid/api/v1", "zano", [](const auto&, auto) -> HttpResponse {throw std::runtime_error("fixture timeout");});
  assert(unavailable == "server scan-info unavailable: fixture timeout");
  std::cout << "{\"passed\":3,\"readOnly\":true,\"scanInfoTimeoutMs\":45000}\n";
}
