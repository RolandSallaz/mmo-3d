import surfaceUrl from "./planet-surface.webp";

const vertexSource = `
  attribute vec2 position;
  varying vec2 point;

  void main() {
    point = position;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision highp float;
  varying vec2 point;
  uniform sampler2D surface;
  uniform float rotation;
  uniform vec2 sunDirection;

  void main() {
    float distanceFromCenter = length(point);
    if (distanceFromCenter > 1.0) discard;

    vec3 normal = vec3(point, sqrt(max(0.0, 1.0 - dot(point, point))));
    vec3 axis = vec3(-0.23, 0.94, 0.25);
    float latitude = asin(clamp(dot(normal, axis), -1.0, 1.0));
    vec3 east = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
    vec3 forward = cross(east, axis);
    float longitude = atan(dot(normal, east), dot(normal, forward));
    vec2 uv = vec2(longitude / 6.2831853 + 0.5 - rotation, 0.5 - latitude / 3.1415927);

    vec3 sunlight = normalize(vec3(sunDirection, 0.42));
    float light = dot(normal, sunlight);
    vec3 albedo = texture2D(surface, uv).rgb;
    vec3 color = albedo * (0.29 + 0.92 * smoothstep(-0.35, 0.9, light));
    float atmosphere = pow(1.0 - normal.z, 3.5) * (0.12 + 0.6 * max(light, 0.0));
    color += vec3(0.29, 0.18, 0.50) * atmosphere;
    gl_FragColor = vec4(color, 1.0 - smoothstep(0.992, 1.0, distanceFromCenter));
  }
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export async function createPlanetRenderer() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 384;
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;

  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const image = new Image();
  image.src = surfaceUrl;
  await image.decode();
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);

  const rotation = gl.getUniformLocation(program, "rotation");
  const sunDirection = gl.getUniformLocation(program, "sunDirection");
  let lastFrame = -Infinity;
  return (time, lightX, lightY) => {
    if (gl.isContextLost()) return null;
    if (time - lastFrame >= 40) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(rotation, (time % 90_000) / 90_000);
      gl.uniform2f(sunDirection, lightX, lightY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastFrame = time;
    }
    return canvas;
  };
}
