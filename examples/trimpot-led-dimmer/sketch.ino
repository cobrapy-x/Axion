// Axion example: trimmer LED dimmer
//  - Trimmer potentiometer: VCC -> 5V, SIG -> A0, GND -> GND
//  - Pin 9 (PWM) -> 220 ohm resistor -> LED -> GND
// Turn the trimmer's screw (drag it round) to set the LED brightness.

const int TRIM_PIN = A0;
const int LED_PIN = 9;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Drag the trimmer's screw to dim the LED.");
}

void loop() {
  int brightness = analogRead(TRIM_PIN) / 4;  // 0..1023 -> 0..255
  analogWrite(LED_PIN, brightness);
  Serial.print("Brightness: ");
  Serial.println(brightness);
  delay(300);
}
