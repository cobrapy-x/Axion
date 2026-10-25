// Axion example: encoder motor speed control through an L298N
//  - Potentiometer on A0: centre = stop, right = forward, left = reverse
//  - L298N channel B: ENB (PWM speed) on 5, IN3 on 7, IN4 on 6, powered by a 9 V battery
//  - Encoder A on pin 3 (INT1), B on pin 2 (INT0)
// The serial monitor shows the commanded speed, measured RPM and shaft position.

const int EN = 5;     // L298N ENB
const int IN_A = 7;   // L298N IN3
const int IN_B = 6;   // L298N IN4
const int ENC_A = 3;
const int ENC_B = 2;
const long COUNTS_PER_REV = 330L * 4;  // 330 pulses per channel x 4 edges

volatile long position = 0;

// Quadrature decoding: every edge of A or B moves the count by one.
void onA() { position += (digitalRead(ENC_A) == digitalRead(ENC_B)) ? -1 : 1; }
void onB() { position += (digitalRead(ENC_A) != digitalRead(ENC_B)) ? -1 : 1; }

void setMotor(int speed) {  // -255 .. 255
  digitalWrite(IN_A, speed > 0);
  digitalWrite(IN_B, speed < 0);
  analogWrite(EN, abs(speed));
}

long readPosition() {
  noInterrupts();
  long p = position;
  interrupts();
  return p;
}

void setup() {
  Serial.begin(115200);
  pinMode(IN_A, OUTPUT);
  pinMode(IN_B, OUTPUT);
  pinMode(ENC_A, INPUT);
  pinMode(ENC_B, INPUT);
  attachInterrupt(digitalPinToInterrupt(ENC_A), onA, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B), onB, CHANGE);
  Serial.println("Turn the knob to drive the motor");
}

unsigned long lastReport = 0;
long lastPosition = 0;

void loop() {
  int speed = map(analogRead(A0), 0, 1023, -255, 255);
  if (abs(speed) < 20) speed = 0;  // dead band around the centre
  setMotor(speed);

  if (millis() - lastReport >= 250) {
    lastReport = millis();
    long p = readPosition();
    float rpm = (p - lastPosition) * 60000.0 / (COUNTS_PER_REV * 250.0);
    lastPosition = p;
    Serial.print("speed=");
    Serial.print(speed);
    Serial.print("  rpm=");
    Serial.print(rpm, 1);
    Serial.print("  turns=");
    Serial.println((float)p / COUNTS_PER_REV, 2);
  }
}
