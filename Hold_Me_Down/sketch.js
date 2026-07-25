/*
Project Title:
  Hold Me Down

Date:
  25 July 2026

Author:
  Jialin Xin

How to Run (Operation Manual):
  - Allow camera access and wait for the body mask to load.
  - Click SENSOR and select the Arduino serial port.
  - Press the silicone hand to control the visual effect.
  - Hold the mouse and move horizontally to test pressure without Arduino.
  - Press D to show or hide the body-mask debug view.
  - Press F to enter or leave fullscreen mode.

What You Should See:
  - A live cyanotype-style mosaic of the camera image.
  - The participant and environment remain visible as blue square tiles.
  - Pressure makes tiles inside the detected body tremble, detach and fall.
  - The background remains stable while the body gradually regenerates.

Mapping Rules (Core Interaction):
  - FSR sensor value is mapped to pressure from 0.0 to 1.0.
  - Higher pressure increases trembling and falling body tiles.
  - Only tiles inside the automatically detected person mask can fall.
  - Released tiles regenerate after pressure is reduced.

Optional Short Intro:
  Hold Me Down translates physical pressure into the fragmentation of a live
  digital body. A silicone cast of the artist's hand becomes a tactile
  interface connecting touch, vulnerability, pressure and recovery.

Acknowledgements / References:
  - p5.js: https://p5js.org/
  - ml5.js: https://ml5js.org/
  - Arduino: https://www.arduino.cc/
  - Web Serial API:
    https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
  - Body segmentation techniques were introduced during class.

AI Use Statement:
  - ChatGPT (https://chat.openai.com/) was used to assist with code debugging
    during development.
  - All conceptual, visual, interaction, material and final creative decisions
    were made by the author.
*/


// Settings

const CAM_W = 320;
const CAM_H = 240;
const FPS = 24;
const TILE = 18;

const BODY_THRESHOLD = 0.20;

const SENSOR_MIN = 15;
const SENSOR_MAX = 850;

const CONTRAST = 1.42;
const BRIGHTNESS_OFFSET = 7;


// Blue palette

const PALETTE = [
  [2, 8, 24],
  [3, 14, 40],
  [4, 23, 61],
  [6, 36, 87],
  [10, 53, 116],
  [17, 75, 151],
  [31, 101, 183],
  [57, 132, 207],
  [91, 163, 225],
  [139, 195, 237],
  [194, 224, 244],
  [243, 247, 239]
];


// Camera and body mask

let video;
let segmenter;
let bodyMask = null;
let modelStarted = false;

let maskMode = "rgb";
let maskChecked = false;
let invertMask = true;
let debugMask = false;


// Grid and particles

let cells = [];
let particles = [];


// Pressure

let pressure = 0;
let targetPressure = 0;
let mousePressureActive = false;


// Serial communication

let sensorButton;

let serialPort = null;
let serialReader = null;
let serialConnected = false;

let serialBuffer = "";
let sensorValue = 0;


// Load body-segmentation model

function preload() {
  segmenter = ml5.bodySegmentation(
    "SelfieSegmentation",
    {
      maskType: "person"
    }
  );
}


// Create canvas, camera and controls

function setup() {
  createCanvas(windowWidth, windowHeight);

  pixelDensity(1);
  frameRate(FPS);

  noStroke();
  rectMode(CENTER);
  textFont("monospace");

  video = createCapture(
    {
      video: {
        width: CAM_W,
        height: CAM_H,
        facingMode: "user"
      },
      audio: false
    },
    startBodySegmentation
  );

  video.size(CAM_W, CAM_H);
  video.hide();

  sensorButton = createButton("SENSOR");
  sensorButton.class("sensor-button");
  sensorButton.mousePressed(connectArduino);

  createGrid();
}


// Start continuous body segmentation

function startBodySegmentation() {
  if (modelStarted) {
    return;
  }

  modelStarted = true;

  segmenter.detectStart(
    video,
    gotSegmentation
  );
}


// Store the latest body mask

function gotSegmentation(results) {
  if (!results) {
    return;
  }

  const result = Array.isArray(results)
    ? results[0]
    : results;

  if (!result) {
    return;
  }

  const possibleMask =
    result.mask ||
    result.segmentationMask ||
    result.personMask ||
    null;

  if (!possibleMask) {
    return;
  }

  bodyMask = possibleMask;
  maskChecked = false;
}


// Create the mosaic grid

function createGrid() {
  cells = [];

  for (
    let y = -TILE;
    y < height + TILE;
    y += TILE
  ) {
    for (
      let x = -TILE;
      x < width + TILE;
      x += TILE
    ) {
      cells.push({
        x: x,
        y: y,
        presence: 1,
        seed: random(10000),
        cooldown: floor(random(0, 10))
      });
    }
  }
}


// Main loop

function draw() {
  background(3, 12, 34);

  positionSensorButton();

  if (!cameraReady()) {
    drawLoading();
    return;
  }

  updatePressure();

  video.loadPixels();

  if (bodyMask) {
    bodyMask.loadPixels();

    if (!maskChecked) {
      detectMaskSettings();
    }
  }

  if (debugMask) {
    drawMaskView();
  } else {
    drawArtwork();
  }

  drawInterface();
}


// Draw the live artwork

function drawArtwork() {
  const cover = getCover();

  push();

  translate(width, 0);
  scale(-1, 1);

  for (const cell of cells) {
    const point = screenToVideo(
      cell.x,
      cell.y,
      cover
    );

    const brightness = sampleVideoBrightness(
      point.x,
      point.y
    );

    const maskValue = getMaskValue(
      point.x,
      point.y
    );

    const insideBody =
      maskValue > BODY_THRESHOLD;

    updateCell(
      cell,
      insideBody,
      maskValue,
      brightness
    );

    drawCell(
      cell,
      insideBody,
      brightness
    );
  }

  updateAndDrawParticles();

  pop();
}


// Update one mosaic tile

function updateCell(
  cell,
  insideBody,
  maskValue,
  brightness
) {
  if (cell.cooldown > 0) {
    cell.cooldown--;
  }

  if (!insideBody) {
    cell.presence = lerp(
      cell.presence,
      1,
      0.30
    );

    return;
  }

  const regenerationSpeed = map(
    pressure,
    0,
    1,
    0.055,
    0.018
  );

  cell.presence = min(
    1,
    cell.presence + regenerationSpeed
  );

  if (
    pressure < 0.04 ||
    cell.cooldown > 0
  ) {
    return;
  }

  const maskStrength = constrain(
    map(
      maskValue,
      BODY_THRESHOLD,
      1,
      0.72,
      1
    ),
    0,
    1
  );

  const pressureStrength =
    pow(pressure, 0.55);

  const dropStrength =
    pressureStrength * maskStrength;

  const dropChance = map(
    dropStrength,
    0,
    1,
    0,
    0.24
  );

  if (
    cell.presence > 0.68 &&
    random() < dropChance
  ) {
    spawnParticle(
      cell,
      brightness,
      dropStrength
    );

    cell.presence = 0;
    cell.cooldown = floor(
      random(8, 24)
    );
  }
}


// Draw one mosaic tile

function drawCell(
  cell,
  insideBody,
  brightness
) {
  if (cell.presence < 0.02) {
    return;
  }

  const textureNoise = noise(
    cell.x * 0.012,
    cell.y * 0.012,
    frameCount * 0.004
  );

  let palettePosition = map(
    brightness,
    0,
    255,
    0,
    PALETTE.length - 1
  );

  palettePosition += map(
    textureNoise,
    0,
    1,
    -0.15,
    0.15
  );

  if (insideBody) {
    palettePosition -=
      pressure * 0.75;
  }

  const paletteIndex = constrain(
    floor(palettePosition),
    0,
    PALETTE.length - 1
  );

  const colour =
    PALETTE[paletteIndex];

  let size = map(
    brightness,
    0,
    255,
    TILE * 0.95,
    TILE * 0.40
  );

  size *= pow(
    cell.presence,
    1.65
  );

  let offsetX = 0;
  let offsetY = 0;

  if (
    insideBody &&
    pressure > 0.08
  ) {
    const tremor =
      pow(pressure, 1.2) * 4.5;

    offsetX =
      sin(
        frameCount * 0.17 +
        cell.seed
      ) * tremor;

    offsetY =
      cos(
        frameCount * 0.14 +
        cell.seed
      ) *
      tremor *
      0.55;
  }

  fill(
    colour[0],
    colour[1],
    colour[2],
    insideBody ? 246 : 232
  );

  rect(
    cell.x + offsetX,
    cell.y + offsetY,
    size,
    size,
    lerp(3, 0.45, pressure)
  );

  if (
    brightness > 202 &&
    size > 6
  ) {
    const glow = map(
      brightness,
      202,
      255,
      38,
      125
    );

    fill(
      246,
      251,
      248,
      glow
    );

    rect(
      cell.x + offsetX,
      cell.y + offsetY,
      size * 0.40,
      size * 0.40,
      1
    );
  } else if (
    textureNoise > 0.76 &&
    size > 7
  ) {
    fill(
      215,
      234,
      242,
      23
    );

    rect(
      cell.x + offsetX,
      cell.y + offsetY,
      size * 0.16,
      size * 0.16,
      1
    );
  }
}


// Create one falling body tile

function spawnParticle(
  cell,
  brightness,
  strength
) {
  let paletteIndex = floor(
    map(
      brightness,
      0,
      255,
      0,
      PALETTE.length - 1
    )
  );

  paletteIndex -= floor(
    strength * 1.2
  );

  paletteIndex = constrain(
    paletteIndex,
    0,
    PALETTE.length - 1
  );

  const colour =
    PALETTE[paletteIndex];

  const baseSize = map(
    brightness,
    0,
    255,
    TILE * 0.98,
    TILE * 0.40
  );

  particles.push({
    x: cell.x,
    y: cell.y,

    vx:
      random(-2.2, 2.2) *
      (0.45 + strength * 1.8),

    vy:
      random(1.2, 3.5) +
      strength * 4.5,

    gravity:
      random(0.15, 0.27) +
      strength * 0.16,

    rotation: 0,

    rotationSpeed:
      random(-0.065, 0.065) *
      (0.5 + strength),

    width:
      baseSize *
      random(0.7, 1.55),

    height:
      baseSize *
      random(0.7, 1.55),

    alpha: 255,
    colour: colour
  });

  if (particles.length > 1000) {
    particles.splice(
      0,
      particles.length - 1000
    );
  }
}


// Animate falling body tiles

function updateAndDrawParticles() {
  for (
    let i = particles.length - 1;
    i >= 0;
    i--
  ) {
    const particle =
      particles[i];

    particle.vy +=
      particle.gravity;

    particle.x +=
      particle.vx;

    particle.y +=
      particle.vy;

    particle.rotation +=
      particle.rotationSpeed;

    if (
      particle.y >
      height * 0.68
    ) {
      particle.alpha -= 6;
    }

    push();

    translate(
      particle.x,
      particle.y
    );

    rotate(
      particle.rotation
    );

    fill(
      particle.colour[0],
      particle.colour[1],
      particle.colour[2],
      particle.alpha
    );

    rect(
      0,
      0,
      particle.width,
      particle.height,
      1
    );

    if (
      particle.colour[0] > 135 &&
      particle.alpha > 80
    ) {
      fill(
        248,
        251,
        246,
        particle.alpha * 0.30
      );

      rect(
        0,
        0,
        particle.width * 0.36,
        particle.height * 0.36,
        0.5
      );
    }

    pop();

    if (
      particle.alpha <= 0 ||
      particle.y > height + 120
    ) {
      particles.splice(i, 1);
    }
  }
}


// Read camera brightness

function sampleVideoBrightness(x, y) {
  const safeX = constrain(
    floor(x),
    0,
    CAM_W - 1
  );

  const safeY = constrain(
    floor(y),
    0,
    CAM_H - 1
  );

  const index =
    (safeX + safeY * CAM_W) * 4;

  const red =
    video.pixels[index] || 0;

  const green =
    video.pixels[index + 1] || 0;

  const blue =
    video.pixels[index + 2] || 0;

  const rawBrightness =
    red * 0.299 +
    green * 0.587 +
    blue * 0.114;

  const enhanced =
    (rawBrightness - 128) *
    CONTRAST +
    128 +
    BRIGHTNESS_OFFSET;

  return constrain(
    enhanced,
    0,
    255
  );
}


// Detect mask channel and direction

function detectMaskSettings() {
  if (
    !bodyMask ||
    !bodyMask.pixels ||
    bodyMask.pixels.length < 4
  ) {
    return;
  }

  let minRGB = 255;
  let maxRGB = 0;

  let minAlpha = 255;
  let maxAlpha = 0;

  let step = floor(
    bodyMask.pixels.length / 400
  );

  step = max(
    4,
    step - (step % 4)
  );

  for (
    let i = 0;
    i < bodyMask.pixels.length;
    i += step
  ) {
    const red =
      bodyMask.pixels[i] || 0;

    const green =
      bodyMask.pixels[i + 1] || 0;

    const blue =
      bodyMask.pixels[i + 2] || 0;

    const alpha =
      bodyMask.pixels[i + 3] || 0;

    const rgb =
      (red + green + blue) / 3;

    minRGB = min(
      minRGB,
      rgb
    );

    maxRGB = max(
      maxRGB,
      rgb
    );

    minAlpha = min(
      minAlpha,
      alpha
    );

    maxAlpha = max(
      maxAlpha,
      alpha
    );
  }

  const rgbRange =
    maxRGB - minRGB;

  const alphaRange =
    maxAlpha - minAlpha;

  maskMode =
    alphaRange > rgbRange &&
    alphaRange > 20
      ? "alpha"
      : "rgb";

  detectPersonDirection();

  maskChecked = true;
}


// Automatically make the person the active mask

function detectPersonDirection() {
  const maskWidth =
    bodyMask.width || CAM_W;

  const maskHeight =
    bodyMask.height || CAM_H;

  let centreTotal = 0;
  let centreCount = 0;

  let borderTotal = 0;
  let borderCount = 0;

  for (
    let y = 0;
    y < maskHeight;
    y += 4
  ) {
    for (
      let x = 0;
      x < maskWidth;
      x += 4
    ) {
      const value =
        getRawMaskValue(
          x,
          y,
          maskWidth
        );

      const inCentre =
        x > maskWidth * 0.25 &&
        x < maskWidth * 0.75 &&
        y > maskHeight * 0.10 &&
        y < maskHeight * 0.90;

      const onBorder =
        x < maskWidth * 0.12 ||
        x > maskWidth * 0.88 ||
        y < maskHeight * 0.12 ||
        y > maskHeight * 0.88;

      if (inCentre) {
        centreTotal += value;
        centreCount++;
      }

      if (onBorder) {
        borderTotal += value;
        borderCount++;
      }
    }
  }

  const centreAverage =
    centreCount > 0
      ? centreTotal / centreCount
      : 0;

  const borderAverage =
    borderCount > 0
      ? borderTotal / borderCount
      : 0;

  if (
    abs(
      centreAverage -
      borderAverage
    ) > 0.04
  ) {
    invertMask =
      borderAverage >
      centreAverage;
  }
}


// Read an unprocessed mask value

function getRawMaskValue(
  maskX,
  maskY,
  maskWidth
) {
  const index =
    (maskX + maskY * maskWidth) * 4;

  const red =
    bodyMask.pixels[index] || 0;

  const green =
    bodyMask.pixels[index + 1] || 0;

  const blue =
    bodyMask.pixels[index + 2] || 0;

  const alpha =
    bodyMask.pixels[index + 3] || 0;

  if (maskMode === "alpha") {
    return alpha / 255;
  }

  return (
    red +
    green +
    blue
  ) / 765;
}


// Read the final person-mask value

function getMaskValue(x, y) {
  if (
    !bodyMask ||
    !bodyMask.pixels ||
    bodyMask.pixels.length === 0
  ) {
    return 0;
  }

  const maskWidth =
    bodyMask.width || CAM_W;

  const maskHeight =
    bodyMask.height || CAM_H;

  if (
    maskWidth <= 0 ||
    maskHeight <= 0
  ) {
    return 0;
  }

  const maskX = constrain(
    floor(
      map(
        x,
        0,
        CAM_W - 1,
        0,
        maskWidth - 1
      )
    ),
    0,
    maskWidth - 1
  );

  const maskY = constrain(
    floor(
      map(
        y,
        0,
        CAM_H - 1,
        0,
        maskHeight - 1
      )
    ),
    0,
    maskHeight - 1
  );

  let value = getRawMaskValue(
    maskX,
    maskY,
    maskWidth
  );

  if (invertMask) {
    value = 1 - value;
  }

  return smoothStep(
    0.10,
    0.72,
    value
  );
}


// Convert screen coordinates to camera coordinates

function screenToVideo(
  x,
  y,
  cover
) {
  return {
    x: constrain(
      floor(
        map(
          x,
          cover.x,
          cover.x + cover.w,
          0,
          CAM_W - 1
        )
      ),
      0,
      CAM_W - 1
    ),

    y: constrain(
      floor(
        map(
          y,
          cover.y,
          cover.y + cover.h,
          0,
          CAM_H - 1
        )
      ),
      0,
      CAM_H - 1
    )
  };
}


// Calculate camera crop

function getCover() {
  const scaleAmount = max(
    width / CAM_W,
    height / CAM_H
  );

  const coverWidth =
    CAM_W * scaleAmount;

  const coverHeight =
    CAM_H * scaleAmount;

  return {
    w: coverWidth,
    h: coverHeight,

    x:
      (width - coverWidth) / 2,

    y:
      (height - coverHeight) / 2
  };
}


// Update pressure input

function updatePressure() {
  if (serialConnected) {
    targetPressure = constrain(
      map(
        sensorValue,
        SENSOR_MIN,
        SENSOR_MAX,
        0,
        1
      ),
      0,
      1
    );
  } else if (mousePressureActive) {
    targetPressure = constrain(
      mouseX / width,
      0,
      1
    );
  } else {
    targetPressure = 0;
  }

  const speed =
    targetPressure > pressure
      ? 0.18
      : 0.055;

  pressure = lerp(
    pressure,
    targetPressure,
    speed
  );

  if (
    abs(
      pressure -
      targetPressure
    ) < 0.002
  ) {
    pressure =
      targetPressure;
  }
}


// Draw body-mask debug view

function drawMaskView() {
  background(0);

  const cover = getCover();

  push();

  translate(width, 0);
  scale(-1, 1);

  for (const cell of cells) {
    const point = screenToVideo(
      cell.x,
      cell.y,
      cover
    );

    const value = getMaskValue(
      point.x,
      point.y
    );

    fill(
      value * 255
    );

    rect(
      cell.x,
      cell.y,
      TILE - 2,
      TILE - 2
    );
  }

  pop();

  push();

  fill(
    255,
    75,
    75
  );

  textSize(13);

  text(
    "MASK DEBUG " +
    maskMode.toUpperCase(),
    20,
    30
  );

  fill(255);

  text(
    "PERSON SHOULD BE WHITE",
    20,
    49
  );

  pop();
}


// Draw pressure and status

function drawInterface() {
  push();

  rectMode(CORNER);
  noStroke();

  const x = 20;
  const y = height - 53;

  fill(
    3,
    13,
    38,
    195
  );

  rect(
    x - 8,
    y - 20,
    190,
    53,
    3
  );

  fill(
    240,
    246,
    244,
    240
  );

  textSize(11);

  text(
    "PRESSURE " +
    pressure.toFixed(2),
    x,
    y
  );

  fill(
    137,
    196,
    230,
    220
  );

  const maskStatus = bodyMask
    ? "BODY MASK READY"
    : "WAITING FOR MASK";

  text(
    maskStatus,
    x,
    y + 18
  );

  pop();
}


// Connect to Arduino

async function connectArduino() {
  if (!("serial" in navigator)) {
    sensorButton.html("NO SERIAL");
    return;
  }

  if (serialConnected) {
    return;
  }

  try {
    serialPort =
      await navigator.serial.requestPort();

    await serialPort.open({
      baudRate: 9600
    });

    serialConnected = true;
    mousePressureActive = false;

    sensorButton.html(
      "SENSOR ●"
    );

    sensorButton.addClass(
      "connected"
    );

    readSerialLoop();
  } catch (error) {
    console.error(
      "Serial connection error:",
      error
    );

    sensorButton.html(
      "SENSOR"
    );
  }
}


// Read Arduino values without while(true)

async function readSerialLoop() {
  if (
    !serialPort ||
    !serialPort.readable
  ) {
    return;
  }

  const decoder =
    new TextDecoder();

  serialReader =
    serialPort.readable.getReader();

  async function readNext() {
    if (!serialReader) {
      return;
    }

    try {
      const result =
        await serialReader.read();

      if (result.done) {
        finishSerialReading();
        return;
      }

      if (result.value) {
        serialBuffer += decoder.decode(
          result.value,
          {
            stream: true
          }
        );

        const lines =
          serialBuffer.split(/\r?\n/);

        serialBuffer =
          lines.pop() || "";

        for (const line of lines) {
          const match =
            line.match(
              /-?\d+(\.\d+)?/
            );

          if (!match) {
            continue;
          }

          const number =
            Number(match[0]);

          if (
            Number.isFinite(number)
          ) {
            sensorValue = number;
          }
        }
      }

      setTimeout(
        readNext,
        0
      );
    } catch (error) {
      console.error(
        "Serial reading error:",
        error
      );

      finishSerialReading();
    }
  }

  readNext();
}


// Reset serial connection state

function finishSerialReading() {
  if (serialReader) {
    try {
      serialReader.releaseLock();
    } catch (error) {
      console.warn(
        "Could not release serial reader:",
        error
      );
    }
  }

  serialReader = null;
  serialConnected = false;

  if (sensorButton) {
    sensorButton.html(
      "SENSOR"
    );

    sensorButton.removeClass(
      "connected"
    );
  }
}


// Keyboard controls

function keyPressed() {
  if (
    key === "d" ||
    key === "D"
  ) {
    debugMask =
      !debugMask;

    return false;
  }

  if (
    key === "f" ||
    key === "F"
  ) {
    fullscreen(
      !fullscreen()
    );

    return false;
  }
}


// Mouse pressure test

function mousePressed(event) {
  if (
    event &&
    sensorButton &&
    event.target ===
      sensorButton.elt
  ) {
    return;
  }

  if (!serialConnected) {
    mousePressureActive = true;
  }
}


function mouseDragged() {
  return false;
}


function mouseReleased() {
  mousePressureActive = false;
}


// Smooth mask transition

function smoothStep(
  minimum,
  maximum,
  value
) {
  if (
    maximum === minimum
  ) {
    return value >= maximum
      ? 1
      : 0;
  }

  const normalized = constrain(
    (
      value -
      minimum
    ) /
    (
      maximum -
      minimum
    ),
    0,
    1
  );

  return (
    normalized *
    normalized *
    (
      3 -
      2 *
      normalized
    )
  );
}


// Check camera state

function cameraReady() {
  return (
    video &&
    video.elt &&
    video.elt.readyState >= 2
  );
}


// Position serial button

function positionSensorButton() {
  if (!sensorButton) {
    return;
  }

  sensorButton.position(
    width - 105,
    18
  );
}


// Display loading message

function drawLoading() {
  push();

  fill(235);

  textAlign(
    CENTER,
    CENTER
  );

  textSize(12);

  text(
    "WAITING FOR CAMERA",
    width / 2,
    height / 2
  );

  pop();
}


// Resize canvas and rebuild grid

function windowResized() {
  resizeCanvas(
    windowWidth,
    windowHeight
  );

  createGrid();
}