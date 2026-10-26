// Test fixture: two chained 74HC595s (chip 1 Q7S -> chip 2 DS), shared clock and latch.
// Phase 1 (t < 100 ms): shiftOut() 0xA5 then 0x3C  -> chip 2 = 0xA5, chip 1 = 0x3C.
// Phase 2 (t > 200 ms): SPI.transfer() 0x81 then 0x42 -> chip 2 = 0x81, chip 1 = 0x42.
#include <SPI.h>

void latch() {
  digitalWrite(10, HIGH);
  digitalWrite(10, LOW);
}

void setup() {
  pinMode(10, OUTPUT);
  pinMode(11, OUTPUT);
  pinMode(13, OUTPUT);
  shiftOut(11, 13, MSBFIRST, 0xA5);
  shiftOut(11, 13, MSBFIRST, 0x3C);
  latch();
  delay(200);
  SPI.begin();
  SPI.transfer(0x81);
  SPI.transfer(0x42);
  latch();
}

void loop() {}
