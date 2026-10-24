// Sender: prints a counter over Serial every 500 ms.
// Its TX pin (1) is wired to the receiver's RX pin (0).
int counter = 0;

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  Serial.print("N");
  Serial.println(counter);
  digitalWrite(LED_BUILTIN, counter % 2);
  counter++;
  delay(500);
}
