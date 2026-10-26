// Axion example: keypad code lock
//  - 4x4 keypad: rows R1..R4 -> pins 9, 8, 7, 6; columns C1..C4 -> pins 5, 4, 3, 2
//  - Green LED (unlocked) on pin 11, red LED (locked) on pin 12, each with a 220 ohm resistor
// Type 1 2 3 4 # on the keypad to unlock. * locks again (or clears a wrong entry).
//
// How the keypad is read ("scanning"): the columns are inputs with pull-ups, so they
// read HIGH. One row at a time is pulled LOW; a pressed key connects that row to its
// column, which then reads LOW. Rows that are not being scanned are left as inputs,
// so two pressed keys can never short two outputs together.

const byte ROWS[4] = {9, 8, 7, 6};
const byte COLS[4] = {5, 4, 3, 2};
const char KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
const int GREEN_LED = 11;
const int RED_LED = 12;
const char CODE[] = "1234";

char entered[8];
byte count = 0;
bool unlocked = false;

char scanKeypad() {
  for (byte r = 0; r < 4; r++) {
    pinMode(ROWS[r], OUTPUT);
    digitalWrite(ROWS[r], LOW);
    delayMicroseconds(10);
    for (byte c = 0; c < 4; c++) {
      if (digitalRead(COLS[c]) == LOW) {
        pinMode(ROWS[r], INPUT);
        return KEYS[r][c];
      }
    }
    pinMode(ROWS[r], INPUT);
  }
  return 0;
}

char waitForKey() {
  char key = scanKeypad();
  if (key == 0) return 0;
  delay(20); // debounce
  while (scanKeypad() == key) delay(5); // wait for release
  return key;
}

void showLock() {
  digitalWrite(GREEN_LED, unlocked ? HIGH : LOW);
  digitalWrite(RED_LED, unlocked ? LOW : HIGH);
}

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < 4; i++) {
    pinMode(ROWS[i], INPUT);
    pinMode(COLS[i], INPUT_PULLUP);
  }
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  showLock();
  Serial.println("Locked. Enter the code and press #");
}

void loop() {
  char key = waitForKey();
  if (key == 0) return;

  if (key == '*') {
    count = 0;
    unlocked = false;
    showLock();
    Serial.println();
    Serial.println("Locked.");
    return;
  }
  if (key == '#') {
    entered[count] = '\0';
    Serial.println();
    if (strcmp(entered, CODE) == 0) {
      unlocked = true;
      Serial.println("Unlocked! Press * to lock again.");
    } else {
      unlocked = false;
      Serial.println("Wrong code, try again.");
      for (byte i = 0; i < 3; i++) { // blink the red LED
        digitalWrite(RED_LED, LOW);
        delay(120);
        digitalWrite(RED_LED, HIGH);
        delay(120);
      }
    }
    count = 0;
    showLock();
    return;
  }
  if (count < sizeof(entered) - 1) entered[count++] = key;
  Serial.print('*'); // never echo the secret digits
}
