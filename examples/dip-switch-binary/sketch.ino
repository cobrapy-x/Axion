// Axion example: read 8 DIP switches as a binary number
//  - DIP switch pins 1a..8a -> Arduino pins 9, 8, 7, 6, 5, 4, 3, 2
//  - DIP switch pins 1b..8b -> GND
// Each pin uses the Arduino's internal pull-up, so it reads HIGH when its switch is
// OFF and LOW when the switch is ON (the switch connects it to GND).
// Switch 1 is the most significant bit. Click the switches while it runs.

const byte PINS[8] = {9, 8, 7, 6, 5, 4, 3, 2};

int last = -1;

byte readSwitches() {
  byte value = 0;
  for (byte i = 0; i < 8; i++) {
    value <<= 1;
    if (digitalRead(PINS[i]) == LOW) value |= 1; // ON = 1
  }
  return value;
}

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < 8; i++) pinMode(PINS[i], INPUT_PULLUP);
}

void loop() {
  byte value = readSwitches();
  if (value != last) {
    last = value;
    Serial.print("Switches: ");
    for (int bit = 7; bit >= 0; bit--) Serial.print((value >> bit) & 1);
    Serial.print(" = ");
    Serial.print(value);
    Serial.print(" (0x");
    if (value < 16) Serial.print('0');
    Serial.print(value, HEX);
    Serial.println(")");
  }
  delay(50);
}
