// Axion example: LDR night light
//  - 5V -> photoresistor (LDR) -> A0 -> 10k resistor -> GND  (a voltage divider)
//  - Pin 9 -> 220 ohm resistor -> LED -> GND
// More light = lower LDR resistance = higher voltage on A0.
// When the reading drops below DARK the LED turns on.
// Run the simulation, click the LDR and drag its Light slider in the inspector.

const int LDR_PIN = A0;
const int LED_PIN = 9;
const int DARK = 400;   // below this it is dark: LED on (about 5 lux with these parts)
const int LIGHT = 450;  // above this it is light again: LED off (a gap avoids flicker)

bool ledOn = false;

// Estimate the light level from the reading (GL5528: 10k at 10 lux, gamma 0.7).
float luxFromReading(int reading) {
  if (reading <= 0) return 0;
  float ldrOhms = 10000.0 * (1023 - reading) / reading;
  return 10.0 * pow(ldrOhms / 10000.0, -1.0 / 0.7);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Night light: click the LDR and drag its Light slider.");
}

void loop() {
  int light = analogRead(LDR_PIN);
  if (!ledOn && light < DARK) ledOn = true;
  else if (ledOn && light > LIGHT) ledOn = false;
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);

  Serial.print("Light: ");
  Serial.print(light);
  Serial.print(" (about ");
  Serial.print(luxFromReading(light), 0);
  Serial.print(" lux)  ");
  Serial.println(ledOn ? "dark -> LED on" : "bright -> LED off");
  delay(500);
}
