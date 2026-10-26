// Axion example: MOSFET motor speed control
//  - Potentiometer: VCC -> 5V, SIG -> A0, GND -> GND
//  - Pin 9 (PWM) -> 220 ohm -> gate (G) of the IRLZ44N; 10k from G to GND keeps it off at reset
//  - 9V battery + -> motor + ; motor - -> drain (D); source (S) -> GND
//  - 1N4007 flyback diode across the motor: anode on D, cathode (band) on 9V +
//  - The battery - and the Uno GND are connected (common ground)
// analogWrite() switches the MOSFET on and off 490 times a second;
// the motor averages it, so the duty cycle sets the speed.

const int POT_PIN = A0;
const int GATE_PIN = 9;

void setup() {
  Serial.begin(115200);
  pinMode(GATE_PIN, OUTPUT);
  Serial.println("Turn the potentiometer to set the motor speed.");
}

void loop() {
  int knob = analogRead(POT_PIN);   // 0..1023
  int duty = knob / 4;              // 0..255
  analogWrite(GATE_PIN, duty);
  Serial.print("Speed: ");
  Serial.print(duty * 100L / 255);
  Serial.println(" %");
  delay(500);
}
