// Axion example: voltage dividers
//  - R1 (10k) from 5V to A0 and R2 (10k) from A0 to GND:
//      A0 = 5 V x R2 / (R1 + R2) = 2.5 V
//  - A potentiometer (10k) between 5V and GND, its wiper (SIG) on A1.
//    R3 (10k) from the wiper to GND *loads* it: half way the wiper reads
//    2.0 V instead of 2.5 V, because R3 is in parallel with the bottom half.
// The voltmeter measures A0 against GND. Turn the knob while it runs.

const float VREF = 5.0;

float volts(int raw) {
  return raw * VREF / 1023.0;
}

void setup() {
  Serial.begin(115200);
  Serial.println("Voltage dividers");
}

void loop() {
  int a0 = analogRead(A0);
  int a1 = analogRead(A1);
  Serial.print("A0 = ");
  Serial.print(volts(a0), 2);
  Serial.print(" V   A1 = ");
  Serial.print(volts(a1), 2);
  Serial.println(" V");
  delay(500);
}
