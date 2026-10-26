// Firmware used by the test suite: pulseIn() with and without interrupts (HC-SR04 on 10/9).
void setup() {
  Serial.begin(115200);
  pinMode(10, OUTPUT);
  pinMode(9, INPUT);
}

unsigned long ping(bool quiet) {
  digitalWrite(10, LOW);
  delayMicroseconds(2);
  digitalWrite(10, HIGH);
  delayMicroseconds(10);
  digitalWrite(10, LOW);
  if (quiet) noInterrupts();
  unsigned long d = pulseIn(9, HIGH, 40000UL);
  if (quiet) interrupts();
  return d;
}

void loop() {
  unsigned long a = ping(false);
  delay(60);
  unsigned long b = ping(true);
  Serial.print("irq=");
  Serial.print(a);
  Serial.print(" noirq=");
  Serial.println(b);
  delay(60);
}
