/*
Project Title:
  Hold Me Down

Date:
  25 July 2026

Author:
  Jialin Xin

How to Run:
  - Connect the FSR circuit to analog pin A0.
  - Upload this code to the Arduino.
  - Close the Arduino Serial Monitor and Serial Plotter.
  - Open the p5.js project in Google Chrome.
  - Click SENSOR and select the Arduino serial port.

What It Does:
  - Reads the pressure sensor connected to A0.
  - Smooths several sensor readings to reduce noise.
  - Sends one numeric sensor value per line at 9600 baud.

Connection:
  - 5V -> FSR -> A0 -> 10k ohm resistor -> GND

AI Use Statement:
  - ChatGPT (https://chat.openai.com/) was used to assist with code debugging
    during development.
*/

const int FSR_PIN = A0;

// Must match the baud rate in sketch.js.
const long BAUD_RATE = 9600;

// Number of readings used for smoothing.
const int SAMPLE_COUNT = 8;

// Send data every 20 milliseconds.
const unsigned long SEND_INTERVAL = 20;

unsigned long previousSendTime = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  pinMode(FSR_PIN, INPUT);

  // Allow the serial connection to initialise.
  delay(1000);
}

void loop() {
  unsigned long currentTime = millis();

  if (currentTime - previousSendTime >= SEND_INTERVAL) {
    previousSendTime = currentTime;

    long total = 0;

    for (int i = 0; i < SAMPLE_COUNT; i++) {
      total += analogRead(FSR_PIN);
      delayMicroseconds(500);
    }

    int sensorValue = total / SAMPLE_COUNT;

    // Send only the number followed by a new line.
    Serial.println(sensorValue);
  }
}
