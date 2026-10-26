// Axion example: RL circuit (inductor current rise)
//  - Pin 8 -> inductor (1 H, 1 ohm of wire) -> 220 ohm resistor -> GND
//  - A0 measures the resistor voltage, which is proportional to the current: I = V / R
//  - A 1N4148 across coil + resistor (band on pin 8) catches the spike if the
//    current is ever interrupted.
// When pin 8 goes HIGH the current cannot jump; it rises as
//   I(t) = I_final x (1 - e^(-t / tau)),  tau = L / R
// and reaches 63.2 % of its final value after one time constant.
// R is 220 + 1 (coil) + about 25 ohm (the pin's own output resistance) = 246 ohm,
// so tau = 1 H / 246 ohm = 4.07 ms.

const int COIL_PIN = 8;

void setup() {
  Serial.begin(115200);
  pinMode(COIL_PIN, OUTPUT);
  digitalWrite(COIL_PIN, LOW);
  Serial.println("RL circuit: L = 1 H, R = 220 + 1 + ~25 ohm, expected tau = L / R = 4.07 ms");
}

void loop() {
  // Measure the final value first (the current settles after about 5 tau).
  digitalWrite(COIL_PIN, HIGH);
  delay(100);
  int final = analogRead(A0);
  digitalWrite(COIL_PIN, LOW);
  delay(100);

  // Switch on and time how long the current takes to reach 63.2 %.
  int target = (long)final * 632 / 1000;
  int prev = 0;
  unsigned long prevT = 0;
  int v;
  unsigned long t;
  unsigned long start = micros();
  digitalWrite(COIL_PIN, HIGH);
  while (true) {
    t = micros() - start;
    v = analogRead(A0);
    if (v >= target) break;
    prev = v;
    prevT = t;
  }
  // Interpolate between the last two samples for a better estimate.
  float tauUs = prevT + (float)(t - prevT) * (target - prev) / (v - prev);

  float mA = final * 5.0 / 1023.0 / 220.0 * 1000.0;
  Serial.print("final current = ");
  Serial.print(mA, 1);
  Serial.print(" mA, tau = ");
  Serial.print(tauUs / 1000.0, 2);
  Serial.println(" ms");
  digitalWrite(COIL_PIN, LOW);
  delay(1000);
}
