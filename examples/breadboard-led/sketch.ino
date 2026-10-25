// Axion example: LED and pushbutton on a breadboard
//  - The LED (pin 13 -> 220 ohm resistor -> LED -> GND rail) blinks every 500 ms
//  - Hold the pushbutton (pin 2 -> button -> GND rail) to blink fast
//  - Parts plugged into the breadboard are connected through its holes;
//    jumper wires bring 5V and GND to the power rails at the bottom

const int LED = 13;
const int BUTTON = 2;

unsigned long lastToggle = 0;
bool ledOn = false;
bool wasPressed = false;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP); // released = HIGH, pressed = LOW
  Serial.begin(115200);
  Serial.println("Breadboard demo: hold the button to blink faster");
}

void loop() {
  bool pressed = digitalRead(BUTTON) == LOW;
  if (pressed != wasPressed) {
    Serial.println(pressed ? "Button pressed" : "Button released");
    wasPressed = pressed;
  }

  unsigned long interval = pressed ? 100 : 500;
  if (millis() - lastToggle >= interval) {
    lastToggle = millis();
    ledOn = !ledOn;
    digitalWrite(LED, ledOn ? HIGH : LOW);
  }
  delay(5);
}
