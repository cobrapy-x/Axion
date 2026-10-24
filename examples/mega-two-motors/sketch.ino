// Axion example: Arduino Mega driving two encoder motors (a little robot base)
//  - L298N: ENA on 11, ENB on 6 (PWM), IN1..IN4 on 10, 9, 8, 7, 12 V battery
//  - Left encoder  A/B on 3/2   (external interrupts INT5/INT4)
//  - Right encoder A/B on 18/19 (external interrupts INT3/INT2)
// The robot drives forward, turns on the spot, then stops, and repeats.
// The left motor is mounted mirrored (as on a real robot), so its power wires are
// swapped (OUT1 -> M-, OUT2 -> M+) and its encoder count is negated in software.

const int ENA = 11, ENB = 6;
const int IN1 = 10, IN2 = 9, IN3 = 8, IN4 = 7;
const int L_A = 3, L_B = 2, R_A = 18, R_B = 19;
const long COUNTS_PER_REV = 330L * 4;

volatile long leftCount = 0, rightCount = 0;

void leftA()  { leftCount  -= (digitalRead(L_A) == digitalRead(L_B)) ? -1 : 1; }  // mirrored
void leftB()  { leftCount  -= (digitalRead(L_A) != digitalRead(L_B)) ? -1 : 1; }
void rightA() { rightCount += (digitalRead(R_A) == digitalRead(R_B)) ? -1 : 1; }
void rightB() { rightCount += (digitalRead(R_A) != digitalRead(R_B)) ? -1 : 1; }

void drive(int left, int right) {  // -255 .. 255 each, positive = robot forward
  digitalWrite(IN1, left > 0);       // wires swapped on the left motor, so the
  digitalWrite(IN2, left < 0);       // same IN pattern moves both wheels forward
  digitalWrite(IN3, right > 0);
  digitalWrite(IN4, right < 0);
  analogWrite(ENA, abs(left));
  analogWrite(ENB, abs(right));
}

void setup() {
  Serial.begin(115200);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(L_A), leftA, CHANGE);
  attachInterrupt(digitalPinToInterrupt(L_B), leftB, CHANGE);
  attachInterrupt(digitalPinToInterrupt(R_A), rightA, CHANGE);
  attachInterrupt(digitalPinToInterrupt(R_B), rightB, CHANGE);
  Serial.println("Mega robot base");
}

unsigned long lastReport = 0;

void loop() {
  unsigned long t = millis() % 4000;
  if (t < 2000) drive(200, 200);        // forward
  else if (t < 3000) drive(150, -150);  // turn right on the spot
  else drive(0, 0);                     // stop

  if (millis() - lastReport >= 500) {
    lastReport = millis();
    noInterrupts();
    long l = leftCount, r = rightCount;
    interrupts();
    Serial.print("left=");
    Serial.print((float)l / COUNTS_PER_REV, 2);
    Serial.print(" turns  right=");
    Serial.print((float)r / COUNTS_PER_REV, 2);
    Serial.println(" turns");
  }
}
