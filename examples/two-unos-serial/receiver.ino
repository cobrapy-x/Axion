// Receiver: reads lines on RX (pin 0) and toggles the LED on pin 7 for each one.
String line;

void setup() {
  Serial.begin(9600);
  pinMode(7, OUTPUT);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      digitalWrite(7, !digitalRead(7));
      Serial.print("Received: ");
      Serial.println(line);
      line = "";
    } else if (c != '\r') {
      line += c;
    }
  }
}
