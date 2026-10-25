// Axion example: play a melody on a piezo buzzer
//  - Buzzer leg 2 (red) on pin 8, leg 1 to GND
// tone(pin, frequency, duration) makes a square wave of that frequency.
// Turn your speakers on to hear it!

const int BUZZER_PIN = 8;

// Notes of the C major scale (frequency in Hz) and their names.
const int NOTE_HZ[] = {262, 294, 330, 349, 392, 440, 494, 523};
const char *const NOTE_NAME[] = {"C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"};

// "Twinkle, Twinkle, Little Star": index into the scale and length in beats.
const int MELODY[] = {0, 0, 4, 4, 5, 5, 4, 3, 3, 2, 2, 1, 1, 0};
const int BEATS[] = {1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2};
const int LENGTH = sizeof(MELODY) / sizeof(MELODY[0]);
const int BEAT_MS = 300;

void setup() {
  Serial.begin(115200);
  Serial.println("Twinkle, Twinkle, Little Star");
}

void loop() {
  for (int i = 0; i < LENGTH; i++) {
    int note = MELODY[i];
    int ms = BEATS[i] * BEAT_MS;
    Serial.print(NOTE_NAME[note]);
    Serial.print(" (");
    Serial.print(NOTE_HZ[note]);
    Serial.println(" Hz)");
    tone(BUZZER_PIN, NOTE_HZ[note], ms * 9 / 10); // short gap between notes
    delay(ms);
  }
  Serial.println("-- again --");
  delay(1000);
}
