// Axion example: switch an LED with an NPN transistor
//  - Pin 7 -> 1k resistor -> transistor base (B)
//  - 5V -> 220 ohm resistor -> LED -> transistor collector (C)
//  - Transistor emitter (E) -> GND
//  - A voltmeter measures the voltage across the LED
// A small base current switches a bigger current through the LED. This is how an
// Arduino pin controls motors, relays and LED strips that need more current
// than the pin can give.

const int BASE_PIN = 7;

void setup() {
  Serial.begin(115200);
  pinMode(BASE_PIN, OUTPUT);
}

void loop() {
  digitalWrite(BASE_PIN, HIGH);
  Serial.println("base HIGH: transistor on, LED on");
  delay(1000);
  digitalWrite(BASE_PIN, LOW);
  Serial.println("base LOW: transistor off, LED off");
  delay(1000);
}
