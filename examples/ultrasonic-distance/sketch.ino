// Axion example: ultrasonic distance meter (HC-SR04)
//  - HC-SR04 VCC -> 5V, GND -> GND, TRIG -> pin 10, ECHO -> pin 9
//  - LED on pin 13 with a 220 ohm resistor (the board's "L" LED follows it):
//    it lights when something is closer than 20 cm
// Select the sensor and drag the Distance slider in the inspector while it runs.
//
// The sensor sends a burst of ultrasound when TRIG gets a 10 us pulse, then holds
// ECHO HIGH until the echo comes back. Sound travels about 0.0343 cm per microsecond
// and has to go there and back, so: distance (cm) = echo time (us) / 58.

const int TRIG_PIN = 10;
const int ECHO_PIN = 9;
const int LED_PIN = 13;
const int NEAR_CM = 20;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
}

void loop() {
  // A clean 10 us trigger pulse
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Wait at most 40 ms for the echo (38 ms = nothing in range)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 40000UL);
  long cm = duration / 58;

  if (duration == 0 || cm > 400) {
    Serial.println("Out of range");
    digitalWrite(LED_PIN, LOW);
  } else {
    Serial.print("Distance: ");
    Serial.print(cm);
    Serial.println(" cm");
    digitalWrite(LED_PIN, cm < NEAR_CM ? HIGH : LOW);
  }
  delay(100);
}
