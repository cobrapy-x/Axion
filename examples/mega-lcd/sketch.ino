// Arduino Mega + 16x2 I2C LCD. The Mega's I2C bus is on pins 20 (SDA) and
// 21 (SCL), also available on the SDA/SCL header next to AREF.
// Same tiny Wire-only LCD driver as the Uno LCD examples.
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

unsigned long count = 0;

void setup() {
  lcdBegin();
  lcdSetCursor(0, 0);
  lcdPrint("Arduino Mega");
  lcdSetCursor(0, 1);
  lcdPrint("I2C 20/21");
}

void loop() {
  char buf[8];
  snprintf(buf, sizeof(buf), "%6lu", count++);
  lcdSetCursor(10, 1);
  lcdPrint(buf);
  delay(100);
}
