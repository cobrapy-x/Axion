// Axion example: servo follows a potentiometer
//  - Potentiometer wiper (SIG) on A0
//  - Servo signal on pin 9
// Turn the knob while the simulation runs and the servo horn follows it.
#include <Servo.h>

Servo servo;
int lastAngle = -1;

void setup() {
  Serial.begin(115200);
  servo.attach(9);
  Serial.println("Turn the knob!");
}

void loop() {
  int raw = analogRead(A0);              // 0 .. 1023
  int angle = map(raw, 0, 1023, 0, 180); // 0 .. 180 degrees
  servo.write(angle);
  if (abs(angle - lastAngle) >= 5) {
    Serial.print("pot=");
    Serial.print(raw);
    Serial.print("  angle=");
    Serial.println(angle);
    lastAngle = angle;
  }
  delay(20);
}
