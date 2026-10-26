// Knight Rider on 8 LEDs through a 74HC595, using hardware SPI.
//
// SPI.transfer() clocks a whole byte out of MOSI (pin 11 -> DS) with SCK
// (pin 13 -> SHCP) in hardware, much faster than shiftOut(). Pin 10 is the
// latch (STCP): its rising edge copies the byte to the outputs Q0-Q7.
#include <SPI.h>

const int latchPin = 10;

void show(byte pattern) {
  digitalWrite(latchPin, LOW);
  SPI.transfer(pattern);
  digitalWrite(latchPin, HIGH);
}

void setup() {
  pinMode(latchPin, OUTPUT);
  SPI.begin();
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
}

void loop() {
  for (int i = 0; i < 7; i++) {
    show(1 << i);
    delay(80);
  }
  for (int i = 7; i > 0; i--) {
    show(1 << i);
    delay(80);
  }
}
