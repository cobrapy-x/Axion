# Axion example: Raspberry Pi Pico, potentiometer dims an LED (MicroPython)
#  - Potentiometer: VCC -> 3V3, GND -> GND, SIG -> GP26 (ADC0)
#  - LED on GP15 through a 220 ohm resistor to GND
# Turn the knob while the simulation runs. MicroPython needs no compiler:
# Axion runs this file on the MicroPython firmware, like "mpremote run main.py".
from machine import ADC, PWM, Pin
import time

pot = ADC(26)        # GP26 = ADC0, reads 0 ... 65535
led = PWM(Pin(15))
led.freq(1000)

while True:
    value = pot.read_u16()
    led.duty_u16(value)
    print("pot:", value, " brightness:", round(value * 100 / 65535), "%")
    time.sleep(0.5)
