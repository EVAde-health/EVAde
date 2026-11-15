import { useEffect, useRef } from 'react';
import { useColorModeContext } from '../context/ColorModeContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import './css/NebulaCanvas.css';

const RESOLUTION_SCALE = 0.6;
const MAX_DPR = 1.5;

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uLight;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = rot * p;
    amp *= 0.5;
  }
  return value;
}

float stars(vec2 uv, float scale, float t) {
  vec2 grid = uv * scale;
  vec2 id = floor(grid);
  vec2 f = fract(grid) - 0.5;
  float h = hash(id);
  if (h < 0.93) return 0.0;
  vec2 offset = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
  float d = length(f - offset * 0.7);
  float twinkle = 0.55 + 0.45 * sin(t * 2.0 + h * 50.0);
  return smoothstep(0.08, 0.0, d) * twinkle * (h - 0.93) * 14.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 parallax = uPointer * 0.05;
  float t = uTime * 0.035;

  vec2 q = vec2(fbm(uv * 1.5 + parallax + t), fbm(uv * 1.5 + vec2(5.2, 1.3) - t));
  float n = fbm(uv * 2.1 + q * 1.9 + parallax * 2.0);

  vec3 dark = vec3(0.015, 0.02, 0.06);
  dark = mix(dark, vec3(0.30, 0.20, 0.75), smoothstep(0.38, 0.9, n));
  dark = mix(dark, vec3(0.08, 0.55, 0.80), smoothstep(0.5, 1.0, q.x * n * 1.7) * 0.8);
  dark += vec3(0.85, 0.25, 0.55) * 0.28 * smoothstep(0.55, 1.0, q.y * n * 1.8);
  dark *= smoothstep(1.5, 0.15, length(uv - vec2(0.25, 0.0)));
  dark += stars(uv + parallax * 0.4, 38.0, uTime) + vec3(0.8, 0.85, 1.0) * stars(uv + parallax, 85.0, uTime * 1.3) * 0.8;

  vec3 light = mix(vec3(0.965, 0.97, 1.0), vec3(0.80, 0.77, 1.0), smoothstep(0.32, 0.9, n));
  light = mix(light, vec3(0.70, 0.90, 1.0), smoothstep(0.5, 1.0, q.x * n * 1.7) * 0.75);
  light = mix(light, vec3(1.0, 0.84, 0.93), smoothstep(0.55, 1.0, q.y * n * 1.8) * 0.55);
  light -= vec3(0.35, 0.3, 0.2) * stars(uv + parallax, 55.0, uTime) * 0.5;

  gl_FragColor = vec4(mix(dark, light, uLight), 1.0);
}`;

// Compiles one shader stage, returning null on failure.
function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

// Links the nebula program and uploads a fullscreen triangle.
function createProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return program;
}

// Fullscreen animated nebula + starfield rendered with a WebGL shader.
export default function NebulaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightTarget = useRef(0);
  const restartRef = useRef<() => void>(() => {});
  const { mode } = useColorModeContext();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    lightTarget.current = mode === 'light' ? 1 : 0;
    restartRef.current();
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    const program = gl && createProgram(gl);
    if (!canvas || !gl || !program) return;

    const uniforms = {
      res: gl.getUniformLocation(program, 'uRes'),
      time: gl.getUniformLocation(program, 'uTime'),
      pointer: gl.getUniformLocation(program, 'uPointer'),
      light: gl.getUniformLocation(program, 'uLight'),
    };
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let light = lightTarget.current;
    let frame = 0;
    let isVisible = true;
    const start = performance.now();

    const resize = () => {
      const scale = Math.min(devicePixelRatio, MAX_DPR) * RESOLUTION_SCALE;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (now: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      light += (lightTarget.current - light) * 0.08;
      gl.uniform2f(uniforms.res, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, reducedMotion ? 20 : (now - start) / 1000);
      gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
      gl.uniform1f(uniforms.light, light);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      draw(now);
      const isSettled = reducedMotion && Math.abs(lightTarget.current - light) < 0.002;
      if (isVisible && !document.hidden && !isSettled) frame = requestAnimationFrame(loop);
    };

    const restart = () => {
      cancelAnimationFrame(frame);
      if (isVisible && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.tx = (event.clientX / innerWidth - 0.5) * 2;
      pointer.ty = (0.5 - event.clientY / innerHeight) * 2;
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      restart();
    });

    resizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    document.addEventListener('visibilitychange', restart);
    if (!reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });
    restartRef.current = restart;
    resize();
    restart();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', restart);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="nebula-canvas" aria-hidden="true" />;
}
