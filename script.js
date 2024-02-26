const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const gpu = new GPU.GPU();
const screenSize = floor(vec(window.innerWidth, window.innerHeight));

// const resolutionScale = Math.min(Math.max(Math.round(prompt("Maze scale?")), 1), 20);
const resolutionScale = 2;
const mazeSize = vec(nearestOdd(16 * resolutionScale), nearestOdd(9 * resolutionScale));
const cellSize = (div(screenSize, mazeSize));
const startLocation = vec(1.25, 1.25);
const endLocation = sub(mazeSize, vec(1.5, 1.5));
const endWidth = Math.min(cellSize.x, cellSize.y) / 2.5;
const charSize = 1;
const maxDistance = mag(screenSize);
const moveSpeed = 0.01;
const roundScale = 0.001;
const roundPosition = false;
const fontSize = screenSize.y / 8;
const fov = 103;
const endLocationScreenSpace = mul(endLocation, cellSize);

const { maze, lines } = generateLines(mazeSize, cellSize);

lines.push({
  a: sub(endLocationScreenSpace, scale(cellSize, 0.25)),
  b: add(endLocationScreenSpace, scale(cellSize, 0.25))
});

const casts = generateCasts(fov, screenSize.x / 2);

const gpuLines = lines.map(line => [line.a.x, line.a.y, line.b.x, line.b.y]);

let char = mul(cellSize, startLocation);
// let char = mul(screenSize, vec(Math.random(), Math.random()));
let lpos = vec(char.x, char.y);
let velocity = vec(0, 0);
let mouse = vec(char.x, char.y);
let won = false;
let explanationRequired = true;
let winExplanationRequired = true;
let time = performance.now();
let direction = 0;
let keyPressed = {};
let fixFactor = 1;

const lineIntersectionKernel = gpu.createKernel(function(char, dir, fixFactor) {
  let cast = this.constants.casts[this.thread.x];
  let vx = char[0];
  let vy = char[1];
  // let vx = char[0] + Math.sin(dir) * cast;
  // let vy = char[1] + (-Math.cos(dir) * cast);
  let fx = vx + Math.cos(dir - cast);
  let fy = vy + Math.sin(dir - cast);
  // let fx = vx + Math.cos(dir);
  // let fy = vy + Math.sin(dir);

  let x = -1.0, y = 0.0, z = 100000.0;

  for (let i = 0; i < this.constants.len; i++) {
    let ax = this.constants.lines[i][0];
    let ay = this.constants.lines[i][1];
    let bx = this.constants.lines[i][2];
    let by = this.constants.lines[i][3];

    let p = (by - ay);
    let q = (bx - vx);
    let r = (by - vy);
    let s = (fx - vx);
    let t = (bx - ax);
    let u = (fy - vy);
    let det = s * p - t * u;

    if (det == 0.0) continue;

    let lambda = (p * q - t * r) / det;
    let gamma = (-u * q + s * r) / det;

    let intersecting = (0.0 < lambda) && (0.0 < gamma && gamma < 1.0);

    if (!intersecting) continue;

    let px = vx + lambda * s;
    let py = vy + lambda * u;

    let dx = vx - px;
    let dy = vy - py;

    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > z) continue;

    x = px;
    y = py;
    z = dist;
  }

  if (fixFactor > 0) {
    z /= Math.cos(cast) * fixFactor;
  } else if (fixFactor < 0) {
    z *= Math.cos(cast) * -fixFactor;
  } else {
    z += 10;
  }

  return [x, y, z];
}, {
  constants: {
    lines: gpuLines, len: lines.length,
    casts: casts
  },
}).setOutput([casts.length])
  .setTactic('speed');

function init() {
  canvas.width = screenSize.x;
  canvas.height = screenSize.y;
  document.addEventListener("mousemove", (e) => {
    mouse = vec(e.x, e.y);
    explanationRequired = false;
    setTimeout(() => winExplanationRequired = false, 5000);
  });

  document.addEventListener("mousedown", (e) => {
    if (won) {
      window.location = window.location;
    }
  });

  document.addEventListener("keypressed", (e) => {
    if (won) {
      window.location = window.location;
    }

    if (e.key == "f") {
      if (fixFactor == 1) fixFactor == 0;
      else if (fixFactor == 0) fixFactor = -1;
      else if (fixFactor == -1) fixFactor = 1;

      else fixFactor = 1;
    }
  });

  document.addEventListener("keydown", (e) => { keyPressed[e.key.toLowerCase()] = true; });
  document.addEventListener("keyup", (e) => { keyPressed[e.key.toLowerCase()] = false; });

  document.title = `Shadowing at (${mazeSize.x}, ${mazeSize.y}) (${resolutionScale})`;
  requestAnimationFrame(loop);
}

function loop() {
  char = vec(Math.round(char.x * 100) / 100, Math.round(char.y * 100) / 100);
  handleMovement();

  while (direction < -Math.PI) direction += Math.PI * 2;
  while (direction > Math.PI) direction -= Math.PI * 2;

  let newTime = performance.now();
  let deltaTime = newTime - time;
  time = newTime;

  // ctx.fillStyle = `rgba(0, 0, 0, 0.1)`;
  // ctx.fillRect(0, 0, screenSize.x, screenSize.y);
  ctx.clearRect(0, 0, screenSize.x, screenSize.y);
  ctx.lineWidth = 1;

  ctx.textAlign = "center";

  ctx.font = `${fontSize / 4}px monospace`;
  ctx.fillStyle = "white";
  ctx.fillText(`You are ${Math.round(dist(char, endLocationScreenSpace))} units away from the finish.`, screenSize.x / 2, fontSize / 4);

  let dt = String(Math.round(deltaTime)) + String(deltaTime % 1).substring(1, 3);
  ctx.textAlign = "left";
  ctx.fillStyle = "green";
  ctx.font = `${fontSize / 6}px monospace`;
  ctx.fillText(`FrameTime: ${dt}ms\nFPS: ${Math.round(1000 / deltaTime)}`, 0, fontSize / 6);

  let gpuChar = [char.x, char.y];
  // let gpuChar = [Math.round(char.x), Math.round(char.y)];
  // let gpuChar = [Math.round(char.x * 10) / 10, Math.round(char.y * 10) / 10];
  // let gpuChar = [Math.round(char.x * 100) / 100, Math.round(char.y * 100) / 100];
  // let gpuChar = [char.x + Math.random() / 100, char.y + Math.random() / 100];
  let scene = lineIntersectionKernel(gpuChar, direction, fixFactor);

  // console.log(scene);

  // scene = scene.map(v => Array.from(v));

  ctx.strokeWidth = .1;
  ctx.fillStyle = `rgba(200, 200, 210, .5)`;
  drawScene(scene);
  // drawGuide();
  // drawLines(lines);
  // drawCasts(casts);
  // drawMaze(maze);

  if (dist(char, endLocationScreenSpace) < endWidth) {
    won = true;
    ctx.clearRect(0, 0, screenSize.x, screenSize.y);

    ctx.fillStyle = "white";
    ctx.textAlign = "center";

    ctx.font = `${fontSize}px monospace`;
    ctx.fillText("You won!", screenSize.x / 2, screenSize.y / 2);

    ctx.font = `${fontSize / 4}px monospace`;
    ctx.fillText("Press anything to play again", screenSize.x / 2, screenSize.y / 2 + fontSize / 2);
  }

  if (!won) requestAnimationFrame(loop);
}

function drawScene(scene) {
  // // ctx.strokeStyle = grd;
  // // ctx.strokeStyle = "gray";
  // ctx.lineWidth = 1;

  let clr0 = [200, 185, 145];
  let clr1 = [24, 24, 24];
  let barWidth = screenSize.x / scene.length;
  let grad = ctx.createRadialGradient(screenSize.x / 2, screenSize.y / 2, 0, screenSize.x / 2, screenSize.y / 2, screenSize.x * 0.8);
  grad.addColorStop(0, `rgb(${clr0.join(",")})`);
  grad.addColorStop(1, `rgb(${clr1.join(",")})`);
  ctx.fillStyle = grad;

  for (let i = 0; i < scene.length; i++) {
    let height = (maxDistance - scene[i][2]) / maxDistance * screenSize.y;

    ctx.globalAlpha = height / screenSize.y * 1;

    if (dist(vec(scene[i][0], scene[i][1]), endLocationScreenSpace) < endWidth) {
      ctx.fillStyle = `rgba(200, 200, 88, ${height / screenSize.y})`;
      ctx.fillRect(i * barWidth, (screenSize.y - height) / 2, barWidth + 1, height);
      ctx.fillStyle = grad;
    } else {
      ctx.fillRect(i * barWidth, (screenSize.y - height) / 2, barWidth + 1, 1)
      ctx.fillRect(i * barWidth, (screenSize.y - height) / 2, barWidth + 1, height);
      ctx.fillRect(i * barWidth, (screenSize.y - height) / 2 + height, barWidth + 1, 1)
    }
  }

  ctx.globalAlpha = 1;

  // ctx.moveTo(scene[0][0], scene[0][1]);
  // for (let i = 0; i < scene.length; i++) {
  //   let nX = scene[i][0];
  //   let nY = scene[i][1];
  //   ctx.lineTo(nX, nY);
  //   lX = nX;
  //   lY = nY;
  // }
  // ctx.fill();

  // ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
  // ctx.beginPath();
  // ctx.arc(endLocation.x * cellSize.x, endLocation.y * cellSize.y, endWidth, 0, Math.PI * 2);
  // ctx.fill();

  // for (let i = 0; i < scene.length; i++) {
  //   // ctx.strokeStyle = scene[i][2] ? "red" : "gray";
  //   // ctx.fillStyle = scene[i][2] ? "red" : "gray";
  //   // ctx.beginPath();
  //   // ctx.moveTo(char.x, char.y);
  //   // ctx.lineTo(scene[i][0], scene[i][1]);
  //   // ctx.stroke();

  //   ctx.fillStyle = "gray";

  //   ctx.beginPath();
  //   ctx.arc(scene[i][0], scene[i][1], 2, 0, Math.PI * 2);
  //   ctx.fill();
  // }
}

function drawGuide() {
  let frad = fov * 0.0174533;
  let dirToEnd = sub(endLocationScreenSpace, char);
  let offset = (direction - Math.atan2(dirToEnd.y, dirToEnd.x)) / 2;

  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(((offset / frad + frad / 2) * screenSize.x), 8, 4, 0, Math.PI * 2);
  ctx.fill();
  // ctx.fillRect((-offset / frad) * screenSize.x, 12, 40, 40);
}

function drawLines(lines) {
  ctx.strokeStyle = "rgba(128, 128, 128, 0.5)";
  ctx.lineWidth = 2;
  for (i = 0; i < lines.length; i++) {
    ctx.beginPath();
    ctx.moveTo(lines[i].a.x, lines[i].a.y);
    ctx.lineTo(lines[i].b.x, lines[i].b.y);
    ctx.stroke();
  }
}

function drawMaze(maze) {
  ctx.fillStyle = "blue";

  for (let x = 0; x < maze[0].length; x++) {
    for (let y = 0; y < maze.length; y++) {
      if (maze[y][x] == 1) {
        ctx.fillRect(x * cellSize.x, y * cellSize.y, 2, 2);
      }
    }
  }
}

function drawCasts(casts) {
  ctx.strokeStyle = "white";
  ctx.fillStyle = "white";
  ctx.lineWidth = 0.5;

  for (let i = 0; i < casts.length; i++) {
    let cast = casts[i];

    if (dist(char, cast) > 800) continue;
    ctx.fillRect(cast.x, cast.y, 1, 1);
    // ctx.beginPath();
    // ctx.moveTo(char.x, char.y);
    // ctx.lineTo(casts[i].x, casts[i].y);
    // ctx.stroke();
  }
}

function angle(e) {
  var dy = e[1] - char.y;
  var dx = e[0] - char.x;
  var theta = Math.atan2(dy, dx); // range (-PI, PI]
  return theta;
}

function handleMovement() {
  let mouseOffset = screenSize.x / 2 - mouse.x;

  direction += mouseOffset / 25000;

  let acc = vec(0, 0);
  let dirVec = vec(Math.cos(direction), Math.sin(direction));

  if (keyPressed.w) acc = add(acc, dirVec);
  // if (keyPressed.a) acc = add(acc, vec(dirVec.y, -dirVec.x));
  if (keyPressed.s) acc = add(acc, scale(dirVec, -1));
  // if (keyPressed.d) acc = add(acc, scale(vec(dirVec.y, -dirVec.x), -1));

  let vel = vec(0, 0);

  if (mag(acc) > 0)
    vel = scale(norm(acc), 6);

  lpos = vec(char.x, char.y);

  let fullCollides = false;
  let horzCollides = false;
  let vertCollides = false;
  let fullLine = line(char, add(char, vec(vel.x + charSize * Math.sign(vel.x), vel.y + charSize * Math.sign(vel.y))));
  let horzLine = line(char, add(char, vec(vel.x + charSize * Math.sign(vel.x), 0)));
  let vertLine = line(char, add(char, vec(0, vel.y + charSize * Math.sign(vel.y))));

  for (let i = 0; i < lines.length; i++) {
    let currLine = lines[i];
    if (cintersects(fullLine, currLine)) fullCollides = true;
    if (cintersects(horzLine, currLine)) horzCollides = true;
    if (cintersects(vertLine, currLine)) vertCollides = true;
  }

  if (!fullCollides) {
    char = add(char, vel);
    return;
  }

  if (horzCollides == vertCollides) return;

  if (!horzCollides) {
    char.x += vel.x;
    return;
  }

  if (!vertCollides) {
    char.y += vel.y;
    return;
  }
}

function cintersects(line1, line2) {
  var a = line1.a.x, b = line1.a.y, c = line1.b.x, d = line1.b.y;
  var p = line2.a.x, q = line2.a.y, r = line2.b.x, s = line2.b.y;
  var det, gamma, lambda;
  det = (c - a) * (s - q) - (r - p) * (d - b);
  if (det === 0) {
    return false;
  } else {
    lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;
    gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;
    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
  }
};

function nearestOdd(x) {
  let n = Math.floor(x);
  if (n % 2 == 0) n--;
  return n;
}

function add(v1, v2) { return { x: v1.x + v2.x, y: v1.y + v2.y }; }
function sub(v1, v2) { return { x: v1.x - v2.x, y: v1.y - v2.y }; }
function div(v1, v2) { return { x: v1.x / v2.x, y: v1.y / v2.y }; }
function mul(v1, v2) { return { x: v1.x * v2.x, y: v1.y * v2.y }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }
function norm(v) { return scale(v, 1 / mag(v)); }
function vec(x, y) { return { x, y }; }
function line(v, w) { return { a: v, b: w }; }
function round(v) { return { x: Math.round(v.x), y: Math.round(v.y) }; }
function floor(v) { return { x: Math.floor(v.x), y: Math.floor(v.y) }; }
function ceil(v) { return { x: Math.ceil(v.x), y: Math.ceil(v.y) }; }
function dist(v, w) { return mag(sub(v, w)); }

init();
