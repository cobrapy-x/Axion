// Potentiometer meter: analogRead(A0) as a number, a percentage and a bar graph
// on a 16x2 I2C LCD. The bar uses 5 custom characters (1 to 5 columns filled),
// so it moves in 80 small steps across the 16 characters.
//
// The LCD driver below is a tiny stand-in for the "LiquidCrystal I2C" library
// (lcd.init(), lcd.setCursor(), lcd.print(), lcd.createChar()), built on Wire only.
#include <Wire.h>

const uint8_t LCD_ADDR = 0x27;
// PCF8574 port bits -> LCD pins on the usual backpack
const uint8_t LCD_RS = 0x01, LCD_EN = 0x04, LCD_BACKLIGHT = 0x08;

// Send 4 bits (on P4-P7) and pulse E; the LCD reads them on the falling edge.
void lcdNibble(uint8_t bits) {
  Wire.beginTransmission(LCD_ADDR);
  Wire.write(bits | LCD_EN | LCD_BACKLIGHT);
  Wire.write(bits | LCD_BACKLIGHT);
  Wire.endTransmission();
  delayMicroseconds(40);
}

// One byte = two nibbles, high first. mode = 0 for a command, LCD_RS for text.
void lcdSend(uint8_t value, uint8_t mode) {
  lcdNibble((value & 0xF0) | mode);
  lcdNibble((value << 4) | mode);
}

void lcdCommand(uint8_t cmd) {
  lcdSend(cmd, 0);
  if (cmd <= 0x03) delay(2);  // clear and home are slow
}

void lcdBegin() {
  Wire.begin();
  delay(50);
  // Reset into 4-bit mode (HD44780 datasheet, "initializing by instruction")
  lcdNibble(0x30); delay(5);
  lcdNibble(0x30); delayMicroseconds(150);
  lcdNibble(0x30);
  lcdNibble(0x20);
  lcdCommand(0x28);  // 4-bit, 2 lines, 5x8 font
  lcdCommand(0x0C);  // display on, cursor off
  lcdCommand(0x06);  // move right after each character
  lcdCommand(0x01);  // clear
}

void lcdSetCursor(uint8_t col, uint8_t row) {
  lcdCommand(0x80 | (col + (row ? 0x40 : 0x00)));
}

void lcdPrint(const char *text) {
  while (*text) lcdSend(*text++, LCD_RS);
}

void lcdWrite(uint8_t ch) {
  lcdSend(ch, LCD_RS);
}

// Store an 5x8 custom character (0-7) in the LCD's CGRAM.
void lcdCreateChar(uint8_t slot, const uint8_t rows[8]) {
  lcdCommand(0x40 | (slot << 3));
  for (uint8_t i = 0; i < 8; i++) lcdSend(rows[i], LCD_RS);
}

// Custom characters 1-5: a block with 1 to 5 columns filled from the left.
void makeBarChars() {
  for (uint8_t cols = 1; cols <= 5; cols++) {
    uint8_t row = (0x1F << (5 - cols)) & 0x1F;
    uint8_t glyph[8];
    for (uint8_t i = 0; i < 8; i++) glyph[i] = (i == 0 || i == 7) ? 0 : row;
    lcdCreateChar(cols, glyph);
  }
}

void drawBar(int value) {
  // 0..1023 -> 0..80 columns of pixels
  int pixels = (long)value * 80 / 1023;
  char line[17];
  for (uint8_t i = 0; i < 16; i++) {
    int fill = pixels - i * 5;
    if (fill >= 5) line[i] = 5;
    else if (fill > 0) line[i] = fill;
    else line[i] = ' ';
  }
  line[16] = 0;
  lcdSetCursor(0, 1);
  lcdPrint(line);
}

int lastValue = -1;

void setup() {
  lcdBegin();
  makeBarChars();
}

void loop() {
  int value = analogRead(A0);
  if (value != lastValue) {
    lastValue = value;
    char buf[17];
    snprintf(buf, sizeof(buf), "A0: %4d  %3d%%  ", value, (int)((long)value * 100 / 1023));
    lcdSetCursor(0, 0);
    lcdPrint(buf);
    drawBar(value);
  }
  delay(50);
}
