// Firmware used by the test suite: Nano analog-only pin A7 and PWM.
void setup() {
  Serial.begin(115200);
  analogWrite(3, 128);
}

void loop() {
  Serial.print("A7=");
  Serial.println(analogRead(A7));
  delay(100);
}
