// Knight Rider on 8 LEDs through a 74HC595 shift register, using shiftOut().
//
// Wiring: pin 11 -> DS (data), pin 13 -> SHCP (shift clock), pin 10 -> STCP (latch).
// OE is tied to GND (outputs on) and MR to 5V (no reset). Each output Q0-Q7
// drives an LED through a 220 ohm resistor.
const int dataPin = 11;
const int clockPin = 13;
const int latchPin = 10;

void show(byte pattern) {
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, pattern);  // Q7 first, Q0 last
  digitalWrite(latchPin, HIGH);                    // rising edge copies the bits to Q0-Q7
}

void setup() {
  pinMode(dataPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(latchPin, OUTPUT);
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
