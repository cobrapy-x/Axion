// Axion example: count from 0 to 9 on a 7-segment display
//  - Common-cathode display: COM goes to GND through a 220 ohm resistor
//  - Segments: A=2, B=3, C=6, D=7, E=8, F=12, G=11
// Each digit is a pattern of lit segments:
//
//      A
//    F   B
//      G
//    E   C
//      D

const int SEGMENT_PINS[7] = {2, 3, 6, 7, 8, 12, 11}; // A, B, C, D, E, F, G

// One row per digit, segments in the order A B C D E F G (1 = lit).
const byte DIGITS[10][7] = {
  {1, 1, 1, 1, 1, 1, 0}, // 0
  {0, 1, 1, 0, 0, 0, 0}, // 1
  {1, 1, 0, 1, 1, 0, 1}, // 2
  {1, 1, 1, 1, 0, 0, 1}, // 3
  {0, 1, 1, 0, 0, 1, 1}, // 4
  {1, 0, 1, 1, 0, 1, 1}, // 5
  {1, 0, 1, 1, 1, 1, 1}, // 6
  {1, 1, 1, 0, 0, 0, 0}, // 7
  {1, 1, 1, 1, 1, 1, 1}, // 8
  {1, 1, 1, 1, 0, 1, 1}, // 9
};

void showDigit(int digit) {
  for (int s = 0; s < 7; s++) {
    digitalWrite(SEGMENT_PINS[s], DIGITS[digit][s] ? HIGH : LOW);
  }
}

void setup() {
  Serial.begin(115200);
  for (int s = 0; s < 7; s++) pinMode(SEGMENT_PINS[s], OUTPUT);
}

void loop() {
  for (int digit = 0; digit <= 9; digit++) {
    showDigit(digit);
    Serial.println(digit);
    delay(500);
  }
}
