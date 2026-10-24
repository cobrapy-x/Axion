// Firmware used by the test suite to exercise ATmega2560 peripherals.
#include <Servo.h>

Servo servo;
volatile long ticks2 = 0, ticks18 = 0;

void onPin2() { ticks2++; }
void onPin18() { ticks18++; }

void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
  pinMode(30, OUTPUT);           // plain GPIO on port C
  pinMode(2, INPUT_PULLUP);
  pinMode(18, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onPin2, FALLING);    // INT4
  attachInterrupt(digitalPinToInterrupt(18), onPin18, FALLING);  // INT3
  analogWrite(5, 64);            // timer 3
  analogWrite(6, 128);           // timer 4
  analogWrite(9, 192);           // timer 2
  servo.attach(44);              // Servo.h uses timer 5 on the Mega
  servo.write(45);
  Serial.println("mega ready");
}

unsigned long last = 0;
void loop() {
  digitalWrite(30, (millis() / 100) % 2);
  if (millis() - last >= 200) {
    last = millis();
    Serial.print("A0=");
    Serial.print(analogRead(A0));
    Serial.print(" A8=");
    Serial.print(analogRead(A8));
    Serial.print(" i2=");
    Serial.print(ticks2);
    Serial.print(" i18=");
    Serial.println(ticks18);
  }
}
