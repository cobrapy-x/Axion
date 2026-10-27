// Axion example: Raspberry Pi Pico, button and LED (Arduino C++, arduino-pico core)
//  - LED on GP15 through a 220 ohm resistor to GND
//  - Pushbutton between GP14 and GND (uses the internal pull-up)
// Each press toggles the LED. Serial is the Pico's USB serial port: open the
// serial monitor in Code to see the count. The on-board LED (GP25) blinks too.

const int LED_PIN = 15;
const int BUTTON_PIN = 14;

bool ledOn = false;
bool lastButton = HIGH;
int presses = 0;
unsigned long lastBlink = 0;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  while (!Serial && millis() < 3000) delay(10);  // wait for the USB serial port
  Serial.println("Press the button!");
}

void loop() {
  bool button = digitalRead(BUTTON_PIN);
  if (button == LOW && lastButton == HIGH) {
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn);
    presses++;
    Serial.print("Presses: ");
    Serial.println(presses);
  }
  lastButton = button;

  if (millis() - lastBlink >= 500) {
    lastBlink = millis();
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
  }
  delay(10);  // also debounces the button
}
