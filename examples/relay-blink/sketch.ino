// Axion example: switch a 9 V circuit with a relay
//  - Relay module: VCC -> 5V, GND -> GND, IN -> pin 7
//  - 9 V battery + -> relay COM
//  - Relay NO -> 470 ohm resistor -> LED -> battery -
//  (NC is free: it is connected to COM while the relay is off)
// The Arduino only drives the relay's input; the relay contact switches the
// battery's own circuit. Watch the relay "click": the contact moves ~10 ms after IN changes.

const int RELAY_PIN = 7;

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
}

void loop() {
  digitalWrite(RELAY_PIN, HIGH);
  Serial.println("Relay ON: COM-NO closed, LED on");
  delay(1000);
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("Relay OFF: COM-NC closed, LED off");
  delay(1000);
}
