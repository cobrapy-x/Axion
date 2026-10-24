// Axion example: blink + fade + button + serial
//  - Red LED on pin 13 blinks (faster while the button is held)
//  - Green LED on pin 9 fades in and out using PWM (analogWrite)
//  - Button on pin 2 goes to GND; the internal pull-up keeps it HIGH otherwise
//  - Type in the serial monitor and the Uno echoes it back

const int RED_LED = 13;
const int GREEN_LED = 9;
const int BUTTON = 2;

unsigned long lastBlink = 0;
bool redOn = false;
int fade = 0;
int fadeStep = 5;
bool wasPressed = false;

void setup() {
  pinMode(RED_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  Serial.begin(115200);
  Serial.println("Axion demo: hold the button to blink faster");
}

void loop() {
  bool pressed = digitalRead(BUTTON) == LOW;
  if (pressed != wasPressed) {
    Serial.println(pressed ? "Button pressed" : "Button released");
    wasPressed = pressed;
  }

  unsigned long interval = pressed ? 100 : 500;
  if (millis() - lastBlink >= interval) {
    lastBlink = millis();
    redOn = !redOn;
    digitalWrite(RED_LED, redOn);
  }

  analogWrite(GREEN_LED, fade);
  fade += fadeStep;
  if (fade <= 0 || fade >= 255) fadeStep = -fadeStep;

  while (Serial.available()) {
    char c = Serial.read();
    Serial.print("You typed: ");
    Serial.println(c);
  }
  delay(10);
}
