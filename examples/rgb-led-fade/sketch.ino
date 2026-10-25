// Axion example: RGB LED colour fade
//  - Common-cathode RGB LED: the long leg (COM) goes to GND
//  - Red on pin 11, green on pin 6, blue on pin 3, each through a 220 ohm resistor
// analogWrite() sets how bright each colour is (0 = off, 255 = full),
// so mixing the three channels makes every colour of the rainbow.

const int RED_PIN = 11;
const int GREEN_PIN = 6;
const int BLUE_PIN = 3;

void setColor(int red, int green, int blue) {
  analogWrite(RED_PIN, red);
  analogWrite(GREEN_PIN, green);
  analogWrite(BLUE_PIN, blue);
}

void setup() {
  Serial.begin(115200);
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  Serial.println("RGB fade");
}

void loop() {
  Serial.println("red -> green");
  for (int i = 0; i <= 255; i += 5) {
    setColor(255 - i, i, 0);
    delay(20);
  }
  Serial.println("green -> blue");
  for (int i = 0; i <= 255; i += 5) {
    setColor(0, 255 - i, i);
    delay(20);
  }
  Serial.println("blue -> red");
  for (int i = 0; i <= 255; i += 5) {
    setColor(i, 0, 255 - i);
    delay(20);
  }
}
