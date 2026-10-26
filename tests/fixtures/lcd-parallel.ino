// Test fixture: 16x2 LCD in parallel 4-bit mode, wired like the LiquidCrystal
// tutorial (RS = 12, E = 11, D4-D7 = 5, 4, 3, 2), driven without a library.
const uint8_t RS = 12, EN = 11;
const uint8_t D[4] = {5, 4, 3, 2};

void nibble(uint8_t v) {
  for (uint8_t i = 0; i < 4; i++) digitalWrite(D[i], (v >> i) & 1);
  digitalWrite(EN, HIGH);
  delayMicroseconds(1);
  digitalWrite(EN, LOW);
  delayMicroseconds(40);
}

void send(uint8_t v, uint8_t rs) {
  digitalWrite(RS, rs);
  nibble(v >> 4);
  nibble(v);
}

void print(const char *s) {
  while (*s) send(*s++, HIGH);
}

void setup() {
  pinMode(RS, OUTPUT);
  pinMode(EN, OUTPUT);
  for (uint8_t i = 0; i < 4; i++) pinMode(D[i], OUTPUT);
  delay(50);
  digitalWrite(RS, LOW);
  nibble(0x3); delay(5);
  nibble(0x3); delayMicroseconds(150);
  nibble(0x3);
  nibble(0x2);
  send(0x28, LOW);  // 4-bit, 2 lines
  send(0x0E, LOW);  // display on, underline cursor
  send(0x06, LOW);
  send(0x01, LOW);
  delay(2);
  print("Parallel 4-bit");
  send(0xC0 | 2, LOW);  // line 2, column 2
  print("D4-D7 ok");
}

void loop() {}
