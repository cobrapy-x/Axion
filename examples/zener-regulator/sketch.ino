// Axion example: zener voltage regulator
//  - 9V battery + -> 470 ohm -> zener cathode (K, band) ; zener anode (A) -> GND
//  - The zener holds its cathode at about 5.1 V; the resistor drops the rest.
//  - 5.1 V is a little more than the Uno's 5 V analog range, so a 10k / 10k divider
//    halves it for A0.
//  - The voltmeter shows the zener voltage. Battery - and Uno GND are connected.

const float RESISTOR = 470.0;
const float BATTERY = 9.0;

void setup() {
  Serial.begin(115200);
  Serial.println("Zener regulator: 9 V -> 470 ohm -> 5.1 V zener");
}

void loop() {
  int reading = analogRead(A0);
  float zener = reading * 5.0 / 1023.0 * 2.0;  // undo the divider
  float mA = (BATTERY - zener) / RESISTOR * 1000.0;
  Serial.print("Zener: ");
  Serial.print(zener, 2);
  Serial.print(" V, current through the resistor: ");
  Serial.print(mA, 1);
  Serial.println(" mA");
  delay(500);
}
