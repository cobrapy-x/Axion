// Firmware used by the test suite: 3.3 V logic. Pin 13 follows pin 2; prints A0 and pin 2.
void setup() {
  Serial.begin(115200);
  pinMode(2, INPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, digitalRead(2));
  Serial.print("A0=");
  Serial.print(analogRead(A0));
  Serial.print(" D2=");
  Serial.println(digitalRead(2));
  delay(50);
}
