// Axion example: RC timing
//  - Pin 8 -> R (10k) -> capacitor + (100uF) ; capacitor - -> GND
//  - The capacitor's + leg is also wired to A0, and the voltmeter measures it.
// When pin 8 goes HIGH the capacitor charges through the resistor:
//   V(t) = 5 V x (1 - e^(-t / RC))
// After one time constant tau = R x C = 10k x 100uF = 1 s it reaches 63 %.
// The sketch measures that time with analogRead() and prints it.

const int CHARGE_PIN = 8;
const int THRESHOLD = 647;  // 63.2 % of 1023
const int EMPTY = 5;        // about 25 mV: the capacitor is discharged

void discharge() {
  digitalWrite(CHARGE_PIN, LOW);
  Serial.println("Discharging...");
  while (analogRead(A0) > EMPTY) {
  }
  delay(100);
}

void setup() {
  Serial.begin(115200);
  pinMode(CHARGE_PIN, OUTPUT);
  Serial.println("RC timing: R = 10k, C = 100uF, expected tau = R x C = 1000 ms");
}

void loop() {
  discharge();
  Serial.println("Charging...");
  unsigned long start = millis();
  digitalWrite(CHARGE_PIN, HIGH);
  while (analogRead(A0) < THRESHOLD) {
  }
  unsigned long tau = millis() - start;
  Serial.print("tau = ");
  Serial.print(tau);
  Serial.println(" ms");
  delay(4000);  // watch it charge to 5 V on the voltmeter
}
