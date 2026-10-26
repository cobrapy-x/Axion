// Hello, Axion! on a 16x2 LCD with an I2C backpack (PCF8574 at 0x27).
//
// With the "LiquidCrystal I2C" library (Library Manager) this is just:
//   LiquidCrystal_I2C lcd(0x27, 16, 2);
//   lcd.init(); lcd.backlight(); lcd.print("Hello, Axion!");
// This example uses a tiny driver built on Wire instead, so it needs no extra
// library and shows what such a library sends to the display.
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

const uint8_t heart[8] = {
  0b00000,
  0b01010,
  0b11111,
  0b11111,
  0b11111,
  0b01110,
  0b00100,
  0b00000,
};

void setup() {
  lcdBegin();
  lcdCreateChar(0, heart);
  lcdSetCursor(0, 0);
  lcdPrint("Hello, Axion!");
  lcdSetCursor(15, 0);
  lcdWrite(0);  // the heart
  lcdSetCursor(0, 1);
  lcdPrint("Uptime:");
}

void loop() {
  char buf[10];
  snprintf(buf, sizeof(buf), "%7lus", millis() / 1000);
  lcdSetCursor(8, 1);
  lcdPrint(buf);
  delay(250);
}
