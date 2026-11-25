#include <iostream>
#include <ArduinoJson.h>

int main() {
  JsonDocument doc;
  deserializeJson(doc, "{\"timing\": {\"send_interval\": \"5000\"}}");
  int val = doc["timing"]["send_interval"] | 5000;
  std::cout << "send_interval=" << val << "\n";
  return 0;
}
