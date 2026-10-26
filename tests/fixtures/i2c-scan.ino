// Test fixture: classic I2C scanner, then a read from the PCF8574 at 0x27.
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.print("found:");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.print(' ');
      Serial.print(a, HEX);
    }
  }
  Serial.println();
  // Port = 0xF0: D4-D7 high (inputs), RS/RW/E/backlight low, then read it back
  Wire.beginTransmission(0x27);
  Wire.write(0xF0);
  Serial.print("write:");
  Serial.println(Wire.endTransmission());
  uint8_t n = Wire.requestFrom(0x27, 2);
  Serial.print("read:");
  Serial.print(n);
  while (Wire.available()) {
    Serial.print(' ');
    Serial.print(Wire.read(), HEX);
  }
  Serial.println();
  Serial.print("missing:");
  Serial.println(Wire.requestFrom(0x50, 1));
}

void loop() {}
