/* Nebula Visuals — сайт. Без библиотек: WebGL-космос, живой HUD, интерактивные карточки. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn('[' + name + ']', e); } };

/* ── курсор ─────────────────────────────────────────────── */
const ptr = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
addEventListener('pointermove', e => {
  ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.nx = e.clientX / innerWidth * 2 - 1; ptr.ny = e.clientY / innerHeight * 2 - 1;
}, { passive: true });

/* ── циклы: каждый идёт, только пока его элемент на экране ──── */
const loops = [];
const seen = new IntersectionObserver(es => es.forEach(e => {
  for (const l of loops) if (l.el === e.target) l.on = e.isIntersecting;
}), { rootMargin: '120px' });
function loop(el, fn) { const l = { el, fn, on: false }; loops.push(l); seen.observe(el); return l; }
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!document.hidden) for (const l of loops) if (l.on) {
    try { l.fn(now / 1000, dt); } catch (e) { console.warn(e); l.on = false; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* Холст 2D под размер своего места; размер следит ResizeObserver, а не кадр. */
function canvas2d(cv) {
  const s = { cv, ctx: cv.getContext('2d'), w: 1, h: 1, d: 1, changed: true };
  const apply = () => {
    const r = cv.getBoundingClientRect();
    s.d = Math.min(devicePixelRatio || 1, 2);
    s.w = Math.max(1, r.width); s.h = Math.max(1, r.height);
    cv.width = Math.round(s.w * s.d); cv.height = Math.round(s.h * s.d);
    s.changed = true;
  };
  new ResizeObserver(apply).observe(cv);
  apply();
  s.begin = () => { s.ctx.setTransform(s.d, 0, 0, s.d, 0, 0); const c = s.changed; s.changed = false; return c; };
  return s;
}

/* Пиксельное лицо 8×8 из палитры — для таргета, аватаров и сети. */
function face(seed) {
  let r = seed * 9301 + 49297;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const skins = [['#c99a72', '#b5845e'], ['#e3bc9a', '#cfa284'], ['#8d5f3f', '#7a4f33'], ['#f1c7a8', '#dcae8e']];
  const hairs = ['#2b1d12', '#5a3820', '#d4a24c', '#1a1a1a', '#8a2b1c', '#e9e2d0', '#3b5bdb'];
  const eyes = ['#3b6fd6', '#2f9b5a', '#6b3fb0', '#5a3a1a'];
  const [s1, s2] = skins[Math.floor(rnd() * skins.length)];
  const h = hairs[Math.floor(rnd() * hairs.length)], e = eyes[Math.floor(rnd() * eyes.length)];
  let px = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let c = (x + y) % 3 ? s1 : s2;
    if (y < 2 || (y === 2 && (x === 0 || x === 7))) c = h;
    if (y === 4 && (x === 1 || x === 6)) c = '#ffffff';
    if (y === 4 && (x === 2 || x === 5)) c = e;
    if (y === 6 && x >= 3 && x <= 4) c = '#6b3f2a';
    px += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
  }
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges">${px}</svg>`;
}

/* ═══════════ навигация, свет, появление, магниты ═══════════ */
safe('nav', () => {
  const nav = $('#nav'), burger = $('#burger'), sheet = $('#sheet');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const close = () => { sheet.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
  burger.addEventListener('click', () => {
    const open = !sheet.classList.contains('open');
    sheet.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
  });
  $$('#sheet a').forEach(a => a.addEventListener('click', close));
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
});

safe('light', () => {
  if (!finePointer || reduce) return;
  const el = $('#light');
  let x = innerWidth / 2, y = innerHeight / 3, shown = false;
  addEventListener('pointermove', () => { if (!shown) { shown = true; el.style.opacity = '1'; } }, { passive: true });
  (function tick() {
    x += (ptr.x - x) * 0.12; y += (ptr.y - y) * 0.12;
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    requestAnimationFrame(tick);
  })();
});

safe('reveal', () => {
  const ob = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); ob.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-r]').forEach(el => ob.observe(el));
});

safe('magnetic', () => {
  if (!finePointer || reduce) return;
  $$('.magnetic').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${(dx * 0.16).toFixed(1)}px, ${(dy * 0.26).toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
});

safe('cards', () => {
  $$('.card').forEach(c => c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }));
});

/* Переключатель-капсула: «таблетка» едет под выбранный вариант. */
function seg(el, onChange) {
  const knob = el.querySelector('.knob'), btns = $$('button', el);
  const place = () => {
    const on = btns.find(b => b.classList.contains('on')) || btns[0];
    knob.style.left = on.offsetLeft + 'px';
    knob.style.width = on.offsetWidth + 'px';
  };
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.toggle('on', x === b));
    place();
    if (onChange) onChange(b.dataset.v);
  }));
  addEventListener('resize', place);
  if (document.fonts) document.fonts.ready.then(place);
  new ResizeObserver(place).observe(el);
  place();
}

/* ═══════════ бегущая строка ═══════════ */
safe('marquee', () => {
  const words = ['Стеклянный HUD', 'Блюр мира', 'Трейлы', 'Северное сияние', 'Снег на блоках', 'Светлячки', 'Гардероб',
    'Portal Live', 'Loot Beams', 'Death Point', 'Свой прицел', 'Колесо эмоций', 'Freelook', 'Motion Blur', 'Цветокоррекция', '120 моделей мечей'];
  const star = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c.4 3.9 1.9 6.1 8 8-6.1 1.9-7.6 4.1-8 8-.4-3.9-1.9-6.1-8-8 6.1-1.9 7.6-4.1 8-8z"/></svg>';
  const html = words.map(w => `<span class="mq">${w}${star}</span>`).join('');
  $('#marquee').innerHTML = html + html;
});

/* ═══════════ первый экран: космос на WebGL ═══════════ */
safe('space', () => {
  const hero = $('.hero'), cv = $('#space'), heroIn = $('#heroIn');

  // Текст уходит вверх и тает, пока прокручиваешь первый экран.
  const onScroll = () => {
    const s = clamp(scrollY / (innerHeight * 0.85));
    heroIn.style.transform = `translate3d(0,${(scrollY * 0.24).toFixed(1)}px,0)`;
    heroIn.style.opacity = (1 - s * 1.1).toFixed(3);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { document.documentElement.classList.add('no-gl'); return; }
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const PREC = hp && hp.precision > 0 ? 'highp' : 'mediump';

  const COMMON = `precision ${PREC} float;
uniform vec2 uRes;
uniform float uPx;
float sq(float x){ return x * x; }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = m * p + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
`;

  // Неподвижный фон — туманность и звёзды — рисуется один раз на размер в текстуру.
  const BG = COMMON + `
vec3 stars(vec2 px, float cell, float density, float rmin, float rmax, float bright){
  vec2 g = px / cell; vec2 id = floor(g); vec2 f = (fract(g) - 0.5) * cell;
  float h = hash12(id);
  if (h > density) return vec3(0.0);
  vec2 off = (vec2(hash12(id + 13.1), hash12(id + 71.7)) - 0.5) * cell * 0.7;
  float d = length(f - off);
  float r = mix(rmin, rmax, hash12(id + 5.3)) * uPx;
  float core = smoothstep(r, r * 0.2, d);
  float halo = exp(-d * d / (r * r * 7.0)) * 0.35;
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.9, 0.82), hash12(id + 9.9));
  tint = mix(tint, vec3(0.86, 0.76, 1.0), step(0.78, hash12(id + 2.2)));
  return tint * (core + halo) * bright * (0.35 + 0.65 * hash12(id + 3.3));
}
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  float halfW = 0.5 * uRes.x / uRes.y;
  vec3 col = mix(vec3(0.020, 0.022, 0.055), vec3(0.008, 0.009, 0.022), smoothstep(-0.5, 0.5, p.y));
  vec2 q = p * 1.2 + vec2(0.35, 0.1);
  vec2 w1 = vec2(fbm(q), fbm(q + vec2(5.2, 1.3)));
  vec2 w2 = vec2(fbm(q + 3.0 * w1 + vec2(1.7, 9.2)), fbm(q + 3.0 * w1 + vec2(8.3, 2.8)));
  float f = fbm(q + 2.6 * w2);
  float dens = smoothstep(0.40, 0.98, f);
  vec3 neb = mix(vec3(0.18, 0.08, 0.46), vec3(0.04, 0.30, 0.80), smoothstep(0.25, 0.85, w1.x));
  neb = mix(neb, vec3(0.80, 0.22, 0.60), smoothstep(0.55, 0.95, w2.y) * 0.5);
  float side = smoothstep(0.1, 0.9, abs(p.x) / halfW);
  float high = smoothstep(0.05, 0.5, p.y);
  float mask = mix(0.30, 1.0, max(side, high * 0.85));
  col += neb * dens * dens * 1.15 * mask;
  col += neb * 0.045 * f;
  col *= 0.8 + 0.2 * smoothstep(0.25, 0.75, fbm(q * 2.3 + 7.1));
  col += stars(frag, 9.0 * uPx, 0.035, 0.55, 0.9, 0.85);
  col += stars(frag + 37.0, 23.0 * uPx, 0.06, 0.8, 1.4, 1.0);
  col += stars(frag + 101.0, 61.0 * uPx, 0.07, 1.1, 2.0, 1.1);
  gl_FragColor = vec4(col, 1.0);
}
`;

  // Каждый кадр: фон со сдвигом за курсором, мерцающие звёзды, планета с кольцом.
  const MAIN = COMMON + `
uniform sampler2D uBg;
uniform float uTime;
uniform vec2 uMouse;
uniform float uRise;
uniform float uScroll;
uniform float uPortrait;
const float R = 6.0;
const float RIN = 7.8;
const float ROUT = 12.3;
float sphereHit(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r; float h = b * b - cc;
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}
float ringA(float r){
  float t = (r - RIN) / (ROUT - RIN);
  if (t < 0.0 || t > 1.0) return 0.0;
  float prof = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.84, 1.0, t));
  float stripes = 0.74 + 0.26 * sin(r * 9.0) * sin(r * 23.0 + 1.3);
  float gap = 1.0 - 0.92 * exp(-sq((t - 0.62) / 0.026));
  float inner = 1.0 - 0.55 * exp(-sq((t - 0.2) / 0.05));
  return clamp(prof * stripes * gap * inner * 0.78, 0.0, 1.0);
}
float twinkle(vec2 px){
  float cell = 54.0 * uPx;
  vec2 g = px / cell; vec2 id = floor(g); vec2 f = (fract(g) - 0.5) * cell;
  float h = hash12(id + 17.0);
  if (h > 0.10) return 0.0;
  vec2 off = (vec2(hash12(id + 1.7), hash12(id + 9.1)) - 0.5) * cell * 0.6;
  vec2 d = f - off;
  float tw = 0.45 + 0.55 * sin(uTime * (0.7 + 2.2 * hash12(id + 4.2)) + h * 60.0);
  float rr = 1.15 * uPx;
  float core = exp(-dot(d, d) / (rr * rr * 2.0));
  float lx = exp(-abs(d.y) / (0.55 * uPx)) * exp(-abs(d.x) / (7.0 * uPx));
  float ly = exp(-abs(d.x) / (0.55 * uPx)) * exp(-abs(d.y) / (7.0 * uPx));
  float flare = (lx + ly) * 0.5 * step(h, 0.035);
  return (core + flare) * max(tw, 0.0);
}
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  vec2 par = vec2(uMouse.x, -uMouse.y) * vec2(0.006, 0.005);
  vec3 col = texture2D(uBg, clamp(uv + par, 0.002, 0.998)).rgb;
  col += vec3(0.85, 0.9, 1.0) * twinkle(frag);

  vec3 ro = vec3(0.0);
  vec3 rd = normalize(vec3(p, -1.25));
  vec3 C = mix(vec3(1.4, -9.2, -12.5), vec3(0.0, -9.0, -11.0), uPortrait);
  C.y -= (1.0 - uRise) * 3.6 + uScroll * 2.4;
  C.x -= uMouse.x * 0.30;
  C.y += uMouse.y * 0.16;
  vec3 L = normalize(vec3(-0.55, 0.72, 0.42));
  vec3 n = normalize(vec3(-0.20, 0.92, 0.38));

  float tp = sphereHit(ro, rd, C, R);
  float tr = -1.0; float rr = 0.0; vec3 Pr = vec3(0.0);
  float den = dot(rd, n);
  if (abs(den) > 1e-4){
    float t = dot(C - ro, n) / den;
    if (t > 0.0){ Pr = ro + rd * t; rr = length(Pr - C); if (rr > RIN && rr < ROUT) tr = t; }
  }

  float along = dot(C - ro, rd);
  if (tp < 0.0 && along > 0.0){
    vec3 cl = ro + rd * along;
    float hgt = max(length(cl - C) - R, 0.0) / R;
    vec3 m = normalize(cl - C);
    float lit = clamp(dot(m, L) * 0.75 + 0.45, 0.0, 1.0);
    float halo = exp(-hgt * 40.0) * 0.95 + exp(-hgt * 9.0) * 0.20 + exp(-hgt * 2.6) * 0.06;
    vec3 hc = mix(vec3(0.45, 0.24, 0.98), vec3(0.32, 0.72, 1.0), lit);
    col += hc * halo * (0.18 + lit);
  }

  if (tp > 0.0){
    vec3 P = ro + rd * tp; vec3 N = normalize(P - C);
    float ang = uTime * 0.012;
    vec3 q = vec3(cos(ang) * N.x - sin(ang) * N.z, N.y, sin(ang) * N.x + cos(ang) * N.z);
    float ct = cos(0.3); float st = sin(0.3);
    q = vec3(q.x, ct * q.y - st * q.z, st * q.y + ct * q.z);
    float lat = q.y; float lon = atan(q.z, q.x);
    vec2 b = vec2(lon * 1.4, lat * 6.5);
    float warp = fbm(vec2(b.x * 1.2, b.y * 2.0) + vec2(3.1, 1.7));
    float bands = fbm(vec2(b.x * 1.8 + warp * 2.0, b.y * 2.6 + warp * 1.4));
    float fine = vnoise(vec2(b.x * 9.0, b.y * 36.0 + warp * 8.0));
    vec3 base = mix(vec3(0.025, 0.05, 0.17), vec3(0.10, 0.22, 0.62), smoothstep(0.22, 0.70, bands));
    base = mix(base, vec3(0.38, 0.66, 1.0), smoothstep(0.60, 0.92, bands) * 0.6);
    base = mix(base, vec3(0.62, 0.48, 1.0), smoothstep(0.55, 0.90, warp) * 0.25);
    base *= 0.82 + 0.36 * fine;
    vec2 sc = vec2(lon - 0.9, (lat - 0.32) * 3.2); float sd = length(sc);
    float storm = smoothstep(0.42, 0.0, sd);
    base = mix(base, vec3(0.75, 0.88, 1.0), storm * 0.35 * (0.6 + 0.4 * sin(sd * 28.0 - atan(sc.y, sc.x) * 2.0)));
    float ndl = dot(N, L);
    float diff = max(ndl, 0.0);
    float fres = pow(1.0 - max(dot(N, -rd), 0.0), 2.4);
    vec3 c = base * (0.03 + 1.3 * pow(diff, 0.85));
    c += vec3(0.42, 0.22, 0.95) * exp(-sq(ndl / 0.16)) * 0.30;
    c += vec3(0.30, 0.66, 1.0) * fres * (0.22 + 1.2 * max(ndl * 0.6 + 0.45, 0.0));
    float sdn = dot(n, L);
    if (abs(sdn) > 1e-4){
      float ts = dot(C - P, n) / sdn;
      if (ts > 0.0){ float rs = length(P + L * ts - C); c *= 1.0 - 0.65 * ringA(rs); }
    }
    col = c;
  }

  if (tr > 0.0 && (tp < 0.0 || tr < tp)){
    float a = ringA(rr);
    float sh = sphereHit(Pr + L * 0.02, L, C, R) > 0.0 ? 0.16 : 1.0;
    float k = 0.38 + 0.62 * abs(dot(n, L));
    float t01 = clamp((rr - RIN) / (ROUT - RIN), 0.0, 1.0);
    vec3 rc = mix(vec3(0.62, 0.74, 1.0), vec3(0.86, 0.76, 1.0), t01) * k * sh;
    rc += vec3(0.3, 0.5, 1.0) * pow(max(dot(rd, L), 0.0), 8.0) * 0.35;
    col = mix(col, rc, a);
  }

  col = 1.0 - exp(-col * 1.35);
  gl_FragColor = vec4(col, 1.0);
}
`;
  const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = fs => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  let bgP, mainP;
  try { bgP = program(BG); mainP = program(MAIN); }
  catch (e) { console.warn(e); document.documentElement.classList.add('no-gl'); return; }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const ub = { res: U(bgP, 'uRes'), px: U(bgP, 'uPx') };
  const um = { res: U(mainP, 'uRes'), px: U(mainP, 'uPx'), bg: U(mainP, 'uBg'), time: U(mainP, 'uTime'), mouse: U(mainP, 'uMouse'),
    rise: U(mainP, 'uRise'), scroll: U(mainP, 'uScroll'), portrait: U(mainP, 'uPortrait') };

  let tex = null, fbo = null, W = 0, H = 0, pxs = 1;
  let q = innerWidth < 760 ? 0.72 : 0.9;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    pxs = dpr * q;
    W = Math.max(2, Math.round(cv.clientWidth * pxs));
    H = Math.max(2, Math.round(cv.clientHeight * pxs));
    cv.width = W; cv.height = H;
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(bgP);
    gl.uniform2f(ub.res, W, H); gl.uniform1f(ub.px, pxs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const start = performance.now();
  let mx = 0, my = 0;
  const draw = () => {
    const tm = (performance.now() - start) / 1000;
    const rise = reduce ? 1 : easeOut(clamp((tm - 0.1) / 2.8));
    mx += (ptr.nx - mx) * 0.045; my += (ptr.ny - my) * 0.045;
    const sc = clamp(scrollY / Math.max(1, hero.offsetHeight));
    gl.viewport(0, 0, W, H);
    gl.useProgram(mainP);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(um.bg, 0);
    gl.uniform2f(um.res, W, H); gl.uniform1f(um.px, pxs); gl.uniform1f(um.time, tm);
    gl.uniform2f(um.mouse, mx, my); gl.uniform1f(um.rise, rise); gl.uniform1f(um.scroll, sc);
    gl.uniform1f(um.portrait, cv.clientWidth / Math.max(1, cv.clientHeight) < 0.9 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  resize();
  draw();
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); draw(); }, 140); });
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); document.documentElement.classList.add('no-gl'); });

  // Медленная видеокарта — меньше точек: среднее время кадра решает, а не догадка.
  let frames = 0, acc = 0;
  loop(hero, (t, dt) => {
    if (reduce) return;
    draw();
    frames++; acc += dt;
    if (frames >= 45) {
      const avg = acc / frames; frames = 0; acc = 0;
      if (avg > 0.024 && q > 0.5) { q = Math.max(0.5, q - 0.12); resize(); }
    }
  });
});

/* ═══════════ HUD: сцена с живыми панелями ═══════════ */
const IC = {
  fps: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5 6 8l3 3 5-6.5"/></svg>',
  ping: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="10" width="2.6" height="4" rx="1.1"/><rect x="6.7" y="6.6" width="2.6" height="7.4" rx="1.1"/><rect x="11.4" y="3" width="2.6" height="11" rx="1.1"/></svg>',
  tps: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.3 1.5" stroke-linecap="round"/></svg>',
  day: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="3.5" width="11" height="10" rx="2.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/></svg>',
  key: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><rect x="1.8" y="4" width="12.4" height="8" rx="2.2"/><path d="M4.8 8h.01M8 8h.01M11.2 8h.01"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"><circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8h2.6"/></svg>',
  shield: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4Z"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="#fff"><path d="M8 1.5a4.6 4.6 0 0 0-4.6 4.6c0 3.4 4.6 8.4 4.6 8.4s4.6-5 4.6-8.4A4.6 4.6 0 0 0 8 1.5Zm0 6.3a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 8.5 2.6 2.6L12 5.6"/></svg>',
  totemMark: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M4 7h8"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1.8 8S4.2 3.5 8 3.5 14.2 8 14.2 8 11.8 12.5 8 12.5 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="2"/></svg>',
  wing: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3C9 3 4 5 2 12c3-2 5-2 7-1 1-3 3-5 5-8Z"/></svg>',
  portal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="8" cy="8" rx="4.2" ry="6"/><ellipse cx="8" cy="8" rx="1.8" ry="3"/></svg>',
  smile: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 9.5c.8 1.2 1.6 1.7 2.5 1.7s1.7-.5 2.5-1.7M6 6.3h.01M10 6.3h.01"/></svg>',
  arrow: '<svg viewBox="0 0 12 12"><path d="M6 1 10.5 10 6 7.8 1.5 10Z" fill="#fff"/></svg>',
};
const ITEM = {
  apple: '<svg class="item" viewBox="0 0 16 16"><path d="M8 4.6c-2-1.4-5.2 0-5.2 3.4 0 3 2.3 5.9 3.7 5.9.7 0 .9-.3 1.5-.3s.8.3 1.5.3c1.4 0 3.7-2.9 3.7-5.9 0-3.4-3.2-4.8-5.2-3.4Z" fill="#f4c430"/><path d="M8 4.6 8.7 2" stroke="#7a4a1c" stroke-width="1.2"/><path d="M8.8 3.4c1-1 2.5-.9 2.5-.9s-.4 1.6-2.5 1.4Z" fill="#5cc15a"/></svg>',
  pearl: '<svg class="item" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#16594f"/><circle cx="8" cy="8" r="4.4" fill="#2aa38d"/><circle cx="6.4" cy="6.2" r="1.7" fill="#b6f5e6"/></svg>',
  snowball: '<svg class="item" viewBox="0 0 16 16"><circle cx="8" cy="8.4" r="5.6" fill="#e9f2ff"/><circle cx="6.3" cy="6.6" r="1.6" fill="#fff"/><circle cx="10" cy="10.4" r="1.2" fill="#c7d8f0"/></svg>',
  helm: '<svg viewBox="0 0 16 16"><path d="M3 9a5 5 0 0 1 10 0v3h-3V9H6v3H3Z" fill="#7ee2f0"/></svg>',
  chest: '<svg viewBox="0 0 16 16"><path d="M4 3h8l1 3v7H3V6Z" fill="#7ee2f0"/><path d="M6 3h4v3H6Z" fill="#4fb3c2"/></svg>',
  boots: '<svg viewBox="0 0 16 16"><path d="M3 4h4v6h2v3H3Zm6 0h4v9h-3v-3h-1Z" fill="#7ee2f0"/></svg>',
  sword: '<svg viewBox="0 0 16 16"><path d="M13 2 7 8l1 1 6-6V2Z" fill="#7ee2f0"/><path d="m4 9 3 3-1 1-3-3Z" fill="#6b4a2a"/><path d="M3.5 11.5 2 13l1 1 1.5-1.5Z" fill="#3a2a1a"/></svg>',
  totem: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="5" y="1" width="6" height="5" fill="#f2c230"/><rect x="6" y="3" width="1" height="1" fill="#1d6b2e"/><rect x="9" y="3" width="1" height="1" fill="#1d6b2e"/><rect x="2" y="6" width="12" height="2" fill="#e0a92a"/><rect x="5" y="8" width="6" height="5" fill="#f2c230"/><rect x="6" y="13" width="4" height="2" fill="#c98f1c"/><rect x="7" y="9" width="2" height="2" fill="#4fd98a"/></svg>',
};
const EFFECT = {
  fire: ['255 140 66', '<svg viewBox="0 0 16 16"><path d="M8 1.5c.5 2.6 3.8 4 3.8 7.4A3.8 3.8 0 0 1 8 12.7a3.8 3.8 0 0 1-3.8-3.8c0-1.6.8-2.6 1.6-3.4.2 1.3.9 2 1.7 2.2C7 6.1 7 3.8 8 1.5Z" fill="#ffb067"/></svg>'],
  speed: ['120 190 255', '<svg viewBox="0 0 16 16" fill="none" stroke="#9fd0ff" stroke-width="2" stroke-linecap="round"><path d="M3 5h6M2 8h8M3 11h6M11 4l3 4-3 4"/></svg>'],
  strength: ['255 95 102', '<svg viewBox="0 0 16 16"><path d="M13 2 7 8l1 1 6-6V2Z" fill="#ff9097"/><path d="m4 9 3 3-1 1-3-3Z" fill="#ff9097"/></svg>'],
  poison: ['130 210 90', '<svg viewBox="0 0 16 16"><path d="M8 2c2.4 3.2 4 5.2 4 7.2a4 4 0 0 1-8 0C4 7.2 5.6 5.2 8 2Z" fill="#9be070"/></svg>'],
};

safe('hud', () => {
  const stage = $('#stage'), inner = $('#stageInner'), cv = $('#world');
  if (!stage) return;

  const day = () => {
    const d = new Date();
    const wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()];
    return wd + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const ring = (frac, color) => {
    const c = 2 * Math.PI * 10.2;
    return `<svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.2" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/>`
      + `<circle class="arc" cx="12" cy="12" r="10.2" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - frac)).toFixed(2)}"/></svg>`;
  };

  const pots = [
    { k: 'fire', name: 'Огнестойкость', lv: '', t: 441, max: 480 },
    { k: 'speed', name: 'Скорость', lv: 'III', t: 141, max: 180 },
    { k: 'strength', name: 'Сила', lv: 'III', t: 141, max: 180 },
    { k: 'poison', name: 'Отравление', lv: 'II', t: 8, max: 20, bad: true },
  ];
  const cds = [
    { item: 'apple', name: 'Зачар. яблоко', t: 8.6, max: 10, color: '#ffd54a' },
    { item: 'pearl', name: 'Жемчуг', t: 4.1, max: 15, color: '#3fd0b5' },
    { item: 'snowball', name: 'Снежок', t: 1.6, max: 4, color: '#cfe0ff' },
  ];

  const html = {
    wm: `<div class="hp wm rim"><span class="brandcell"><i></i>Nebula</span>
      <span class="it"><span class="ac">${IC.fps}</span><b class="num" data-fps>597</b><small>fps</small></span><span class="dv"></span>
      <span class="it"><span class="ac">${IC.ping}</span><b class="num" data-ping>18</b><small>ms</small></span><span class="dv"></span>
      <span class="it"><span class="ac">${IC.tps}</span><b class="num">19.8</b><small>tps</small></span><span class="dv"></span>
      <span class="it"><span class="ac">${IC.day}</span><b data-day>${day()}</b></span></div>`,
    binds: `<div class="hp rim" style="min-width:214px"><div class="hh"><span class="tile">${IC.key}</span>Бинды</div><div class="hsep"></div>
      <div class="hrow"><span class="ac">${IC.eye}</span><span class="grow">Freelook</span><span class="key">ALT</span></div>
      <div class="hrow"><span class="ac">${IC.wing}</span><span class="grow">Elytra Swap</span><span class="key">R</span></div>
      <div class="hrow"><span class="ac">${IC.portal}</span><span class="grow">Portal Live</span><span class="key">P</span></div>
      <div class="hrow"><span class="ac">${IC.smile}</span><span class="grow">Эмоции</span><span class="key">B</span></div></div>`,
    cds: `<div class="hp rim" style="min-width:222px"><div class="hh"><span class="tile">${IC.clock}</span>Задержки</div><div class="hsep"></div>`
      + cds.map((c, i) => `<div class="hrow"><span class="slot" data-cd="${i}">${ring(c.t / c.max, c.color)}${ITEM[c.item]}</span><span class="grow">${c.name}</span><b class="num" data-cdt="${i}">${c.t.toFixed(1)}с</b></div>`).join('')
      + `</div>`,
    pots: `<div class="pots">` + pots.map((p, i) => {
      const [rgb, svg] = EFFECT[p.k];
      return `<div class="hp pot${p.bad ? ' bad' : ''}"><span class="badge" style="background:rgb(${rgb} / .2);box-shadow:0 0 12px rgb(${rgb} / .45)">${svg}</span>`
        + `<span class="nm">${p.name}${p.lv ? `<span class="lv">${p.lv}</span>` : ''}</span><span class="tpill num${p.t < 10 ? ' warn' : ''}" data-pt="${i}">${mmss(p.t)}</span></div>`;
    }).join('') + `</div>`,
    target: `<div class="hp target rim"><div class="top"><div class="face">${face(7)}</div>
      <div style="flex:1;min-width:0"><div class="name">Stardust_</div><div class="dim" style="font-size:11px;margin-top:3px">Игрок · 3.4 м</div></div>
      <div style="text-align:right"><div class="hpv num" data-hp>14.5</div><div style="font-size:11px;font-weight:600;color:#ffd04d;margin-top:2px">+4</div></div></div>
      <div class="hbar"><b data-hpbar></b><b data-shield style="background:#ffd04d;box-shadow:0 0 8px rgba(255,208,77,.7)"></b></div>
      <div class="gear"><span>${ITEM.helm}</span><span>${ITEM.chest}</span><span>${ITEM.boots}</span><span>${ITEM.sword}</span></div></div>`,
    totem: `<div class="hp totem" data-totem>${ITEM.totem}<span class="num" data-totems>3</span></div>`,
    gps: `<div class="hp gps"><span class="tile">${IC.pin}</span><span class="dim" style="font-size:12px">GPS · 1250, -340</span><b class="num">187 м</b><span class="dial"><span data-arrow style="display:grid">${IC.arrow}</span></span></div>`,
    armor: `<div class="hp" style="padding:8px 12px 8px 9px;min-width:178px">` + [['helm', 92, '#34d399'], ['chest', 64, '#ffd04d'], ['boots', 31, '#ff9f43'], ['sword', 9, '#ff5f66']]
      .map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:10px;height:30px"><span style="width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.06);display:grid;place-items:center"><span style="width:14px;height:14px;display:grid">${ITEM[k]}</span></span>`
        + `<span style="flex:1;height:4px;border-radius:4px;background:rgba(255,255,255,.08);position:relative;overflow:hidden"><b style="position:absolute;left:0;top:0;bottom:0;width:${v}%;background:${c};box-shadow:0 0 6px ${c};border-radius:4px"></b></span>`
        + `<b class="num" style="width:36px;text-align:right;font-size:12px;color:${v < 20 ? '#ff8a90' : '#f3f5fa'}">${v}%</b></div>`).join('') + `</div>`,
    toast: `<div class="hp toast"><span class="badge" style="width:24px;height:24px;background:#34d399;box-shadow:0 0 14px rgba(52,211,153,.6)">${IC.check}</span><span class="t" data-tt>Trails</span><span class="dim" data-td>включено</span><span class="tb"><b data-tb></b></span></div>`,
    cross: `<div class="cross"></div>`,
  };
  const els = {};
  for (const k of Object.keys(html)) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html[k].trim();
    els[k] = inner.appendChild(wrap.firstElementChild);
  }

  // Две раскладки: широкая (экран монитора) и высокая (телефон).
  const LAYOUT = {
    wide: { w: 1200, h: 675, p: {
      wm: { l: 22, t: 20 }, binds: { l: 22, t: 74 }, pots: { l: 22, t: 286 }, cds: { r: 22, t: 20 }, toast: { r: 22, t: 196 },
      gps: { c: 600, b: 26 }, target: { c: 600, t: 396 }, totem: { l: 752, t: 396 }, armor: { r: 22, b: 26 }, cross: { l: 600, t: 300 } } },
    tall: { w: 560, h: 920, p: {
      wm: { l: 16, t: 16 }, gps: { l: 16, t: 66 }, binds: { l: 16, t: 116 }, cds: { r: 16, t: 116 },
      pots: { l: 16, t: 318 }, armor: { r: 16, t: 318 }, target: { l: 16, t: 506 }, totem: { l: 290, t: 506 },
      toast: { l: 16, b: 22 }, cross: { l: 400, t: 700 } } },
  };
  let mode = '';
  const place = () => {
    const width = stage.clientWidth;
    const next = width < 700 ? 'tall' : 'wide';
    const L = LAYOUT[next];
    const s = width / L.w;
    stage.style.height = Math.round(L.h * s) + 'px';
    inner.style.width = L.w + 'px'; inner.style.height = L.h + 'px';
    inner.style.transform = `scale(${s})`;
    if (next === mode) return;
    mode = next;
    for (const [k, pos] of Object.entries(L.p)) {
      const el = els[k];
      el.style.left = el.style.right = el.style.top = el.style.bottom = '';
      let ox = 'left', oy = 'top';
      if (pos.l != null) el.style.left = pos.l + 'px';
      if (pos.r != null) { el.style.right = pos.r + 'px'; ox = 'right'; }
      if (pos.c != null) { el.style.left = (pos.c - el.offsetWidth / 2) + 'px'; ox = 'center'; }
      if (pos.t != null) el.style.top = pos.t + 'px';
      if (pos.b != null) { el.style.bottom = pos.b + 'px'; oy = 'bottom'; }
      el.style.setProperty('--o', ox + ' ' + oy);
    }
  };
  new ResizeObserver(place).observe(stage);
  if (document.fonts) document.fonts.ready.then(() => { mode = ''; place(); });
  place();

  // Живые значения: время тикает, здоровье цели тает, тотем срабатывает.
  let hp = 14.5, shield = 4, totems = 3, toastIdx = 0, tick = 0;
  const toasts = [['Trails', 'включено'], ['Тотем', 'спас Stardust_'], ['Freelook', 'включено'], ['Loot Beams', 'включено']];
  const hpColor = f => f > 0.6 ? ['#34d399', '#7ef0b0', 'rgba(52,211,153,.7)'] : f > 0.3 ? ['#ffb44a', '#ffd07a', 'rgba(255,180,74,.7)'] : ['#ff5f66', '#ff9aa0', 'rgba(255,95,102,.7)'];
  const paintHp = () => {
    const f = hp / 20, [c1, c2, glow] = hpColor(f);
    const v = inner.querySelector('[data-hp]'), bar = inner.querySelector('[data-hpbar]'), sh = inner.querySelector('[data-shield]');
    v.textContent = hp.toFixed(1); v.style.color = c1;
    bar.style.width = (f * 100) + '%'; bar.style.background = `linear-gradient(90deg,${c1},${c2})`; bar.style.boxShadow = `0 0 8px ${glow}`;
    sh.style.left = (f * 100) + '%'; sh.style.width = Math.min(100 - f * 100, shield / 20 * 100) + '%';
    const t = inner.querySelector('[data-totem]');
    t.classList.toggle('scarce', totems <= 1);
    inner.querySelector('[data-totems]').textContent = totems;
  };
  const showToast = (title, detail) => {
    inner.querySelector('[data-tt]').textContent = title;
    inner.querySelector('[data-td]').textContent = detail;
    const b = inner.querySelector('[data-tb]');
    b.style.transition = 'none'; b.style.width = '100%';
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = 'width 4.2s linear'; b.style.width = '0%'; }));
  };
  paintHp();
  showToast(...toasts[0]);
  setInterval(() => {
    if (document.hidden) return;
    tick++;
    inner.querySelector('[data-fps]').textContent = Math.round(560 + Math.random() * 70);
    inner.querySelector('[data-ping]').textContent = Math.round(14 + Math.random() * 8);
    inner.querySelector('[data-day]').textContent = day();
    pots.forEach((p, i) => {
      p.t = p.t <= 1 ? p.max : p.t - 1;
      const el = inner.querySelector(`[data-pt="${i}"]`);
      el.textContent = mmss(p.t);
      el.classList.toggle('warn', p.t < 10);
    });
    cds.forEach((c, i) => {
      c.t = c.t <= 1 ? c.max : c.t - 1;
      inner.querySelector(`[data-cdt="${i}"]`).textContent = c.t.toFixed(1) + 'с';
      const arc = inner.querySelector(`[data-cd="${i}"] .arc`);
      const len = 2 * Math.PI * 10.2;
      arc.style.transition = 'stroke-dashoffset .9s linear';
      arc.setAttribute('stroke-dashoffset', (len * (1 - c.t / c.max)).toFixed(2));
    });
    hp -= 0.6 + Math.random() * 1.6;
    if (shield > 0 && Math.random() < 0.3) shield = Math.max(0, shield - 1);
    if (hp < 2.5) {
      hp = 20; shield = 4;
      totems = totems > 1 ? totems - 1 : 3;
      showToast('Тотем', 'спас Stardust_');
    } else if (tick % 5 === 0) {
      toastIdx = (toastIdx + 1) % toasts.length;
      if (toasts[toastIdx][0] !== 'Тотем') showToast(...toasts[toastIdx]);
    }
    paintHp();
    inner.querySelector('[data-arrow]').style.transform = `rotate(${Math.round(Math.sin(tick / 3) * 50)}deg)`;
  }, 1000);

  // Настройки: цвет темы, фон панелей, размер.
  const colors = [['77 141 255', 'Синий'], ['155 123 255', 'Фиолетовый'], ['255 122 192', 'Розовый'], ['255 95 102', 'Красный'],
    ['255 159 67', 'Оранжевый'], ['52 211 153', 'Зелёный'], ['79 209 255', 'Голубой'], ['230 170 40', 'Золотой']];
  const sw = $('#swatches');
  sw.innerHTML = colors.map(([c, n], i) => `<button class="sw-c${i === 0 ? ' on' : ''}" role="radio" aria-checked="${i === 0}" aria-label="${n}" title="${n}" style="--c:rgb(${c})" data-c="${c}"></button>`).join('');
  $$('.sw-c', sw).forEach(b => b.addEventListener('click', () => {
    $$('.sw-c', sw).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    stage.style.setProperty('--acc', b.dataset.c);
    document.documentElement.style.setProperty('--acc', b.dataset.c);
  }));
  seg($('#matSeg'), v => { stage.dataset.mat = v; });
  const size = $('#hudSize');
  const applySize = () => {
    stage.style.setProperty('--hs', (size.value / 100).toFixed(2));
    size.style.setProperty('--p', ((size.value - size.min) / (size.max - size.min) * 100) + '%');
  };
  size.addEventListener('input', applySize);
  applySize();

  // Мир за панелями: закат над пиксельными холмами — его и размывает стекло.
  const world = World(cv);
  let wx = 0, wy = 0;
  new ResizeObserver(() => world.build()).observe(cv);
  world.build();
  loop(stage, (t, dt) => {
    const r = stage.getBoundingClientRect();
    const tx = clamp((ptr.x - r.left) / Math.max(1, r.width), -0.5, 1.5) * 2 - 1;
    const ty = clamp((ptr.y - r.top) / Math.max(1, r.height), -0.5, 1.5) * 2 - 1;
    wx += (tx - wx) * 0.05; wy += (ty - wy) * 0.05;
    world.draw(reduce ? 0 : dt, wx, wy);
  });
});

function World(cv) {
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, d = 1, sky = null, hills = [], clouds = [];
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const wave = (x, s) => 0.5 + 0.22 * Math.sin(x * 1.3 + s) + 0.16 * Math.sin(x * 2.7 + s * 1.7) + 0.08 * Math.sin(x * 6.1 + s * 2.3) + 0.04 * Math.sin(x * 11.3 + s * 3.1);
  const off = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d)); const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return [c, g]; };
  function build() {
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    W = r.width; H = r.height; d = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(W * d); cv.height = Math.round(H * d);
    const rnd = mulberry(7);
    let g;
    [sky, g] = off(W, H);
    const gr = g.createLinearGradient(0, 0, 0, H);
    [[0, '#060a26'], [0.30, '#171c5c'], [0.52, '#4b2d8a'], [0.68, '#a2458f'], [0.80, '#f07a86'], [0.90, '#ffad7f'], [1, '#ffd29a']].forEach(([o, c]) => gr.addColorStop(o, c));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 170; i++) {
      const x = rnd() * W, y = rnd() * H * 0.5;
      const a = Math.max(0, 1 - y / (H * 0.5)) * (0.25 + rnd() * 0.75);
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      const s = rnd() < 0.08 ? 2 : 1;
      g.fillRect(Math.round(x), Math.round(y), s, s);
    }
    const sx = W * 0.70, sy = H * 0.585;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.75);
    sg.addColorStop(0, 'rgba(255,220,160,.85)'); sg.addColorStop(0.16, 'rgba(255,160,130,.45)'); sg.addColorStop(0.5, 'rgba(220,90,150,.12)'); sg.addColorStop(1, 'rgba(200,80,160,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    const ss = Math.round(H * 0.105);
    g.fillStyle = '#fff1c9'; g.fillRect(Math.round(sx - ss / 2), Math.round(sy - ss / 2), ss, ss);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(Math.round(sx - ss * 0.3), Math.round(sy - ss * 0.3), Math.round(ss * 0.6), Math.round(ss * 0.6));
    const defs = [
      { top: '#8a5fc0', bot: '#6a4aa5', base: 0.64, amp: 0.13, block: 0.017, seed: 1.3, par: 8, freq: 2.2 },
      { top: '#4a3790', bot: '#33276f', base: 0.72, amp: 0.11, block: 0.023, seed: 4.1, par: 18, freq: 2.8 },
      { top: '#211d55', bot: '#15133a', base: 0.82, amp: 0.085, block: 0.031, seed: 7.7, par: 34, freq: 3.4, trees: true },
    ];
    hills = defs.map(df => {
      const pad = 60, tw = W + pad * 2;
      const [c, lg] = off(tw, H);
      const b = Math.max(4, Math.round(H * df.block));
      const g2 = lg.createLinearGradient(0, H * (df.base - df.amp), 0, H);
      g2.addColorStop(0, df.top); g2.addColorStop(1, df.bot);
      lg.fillStyle = g2;
      const tops = [];
      for (let x = 0; x < tw; x += b) {
        const n = wave((x / tw) * df.freq * Math.PI, df.seed);
        const y = Math.round((H * df.base - (n - 0.5) * 2 * H * df.amp) / b) * b;
        lg.fillRect(x, y, b + 0.5, H - y + 1);
        tops.push([x, y]);
      }
      if (df.trees) {
        const rr = mulberry(5);
        for (const [x, y] of tops) if (rr() < 0.13) {
          lg.fillStyle = '#100d28'; lg.fillRect(x, y - b * 2, b, b * 2);
          lg.fillStyle = '#16133a'; lg.fillRect(x - b, y - b * 4, b * 3, b * 2.2); lg.fillRect(x, y - b * 5, b, b);
        }
      }
      lg.globalCompositeOperation = 'source-atop';
      const hz = lg.createLinearGradient(0, H * (df.base - df.amp * 1.2), 0, H * (df.base + 0.12));
      hz.addColorStop(0, 'rgba(255,170,190,.22)'); hz.addColorStop(1, 'rgba(255,170,190,0)');
      lg.fillStyle = hz; lg.fillRect(0, 0, tw, H);
      lg.globalCompositeOperation = 'source-over';
      return { c, pad, par: df.par, tw };
    });
    clouds = Array.from({ length: 8 }, () => {
      const s = Math.max(3, Math.round(H * (0.012 + rnd() * 0.01)));
      const cols = 5 + Math.floor(rnd() * 8), rows = 2 + Math.floor(rnd() * 2);
      const cells = [];
      for (let ry = 0; ry < rows; ry++) for (let q = 0; q < cols; q++) {
        if (rnd() < (ry === 0 ? 0.55 : 0.92) && !(ry === rows - 1 && (q === 0 || q === cols - 1))) cells.push([q, ry]);
      }
      return { x: rnd() * W, y: H * (0.08 + rnd() * 0.34), s, cells, v: 4 + rnd() * 9, a: 0.3 + rnd() * 0.35 };
    });
  }
  function draw(dt, mx, my) {
    if (!sky) return;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.drawImage(sky, 0, 0, W, H);
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 140) c.x = -180;
      ctx.fillStyle = `rgba(255,226,240,${c.a})`;
      for (const [q, ry] of c.cells) ctx.fillRect(Math.round(c.x + q * c.s - mx * 6), Math.round(c.y + ry * c.s), c.s, c.s);
    }
    for (const h of hills) ctx.drawImage(h.c, -h.pad - mx * h.par, my * h.par * 0.25, h.tw, H);
    const fog = ctx.createLinearGradient(0, H * 0.55, 0, H);
    fog.addColorStop(0, 'rgba(30,20,70,0)'); fog.addColorStop(1, 'rgba(10,8,30,.45)');
    ctx.fillStyle = fog; ctx.fillRect(0, 0, W, H);
  }
  return { build, draw };
}

/* ═══════════ карточка: меню ═══════════ */
safe('menu', () => {
  const S = {
    spark: '<svg viewBox="0 0 16 16" fill="#fff"><path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5Z"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="#fff"><path d="M13 10.3A6 6 0 0 1 5.7 3a6 6 0 1 0 7.3 7.3Z"/></svg>',
    panel: '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="2.4"/><path d="M2 6.5h12"/></svg>',
    crown: '<svg viewBox="0 0 16 16" fill="#fff"><path d="m2 5 3 2.8L8 3l3 4.8L14 5l-1.3 7.5H3.3Z"/></svg>',
  };
  const cats = [
    { name: 'Визуалы', c: '#4d8dff', i: S.spark, items: [['Trails', '#9b7bff', 'цветом темы', 1], ['Jump Circle', '#4fd1ff', 'круг при прыжке', 0], ['Hit Particles', '#ff9f43', 'искры удара', 1], ['Kill Effects', '#ff5f66', 'конфетти и души', 1]] },
    { name: 'Мир', c: '#34c759', i: S.moon, items: [['Ambience', '#34c759', 'небо, туман, снег', 1], ['Loot Beams', '#ffd04d', 'лучи над лутом', 1], ['Death Point', '#ff5f66', 'путь к вещам', 0], ['Fullbright', '#ffb44a', 'без темноты', 0]] },
    { name: 'HUD', c: '#30b0c7', i: S.panel, items: [['Watermark', '#4d8dff', 'fps, ms, время', 1], ['Target HUD', '#ff7ac0', 'здоровье цели', 1], ['Potions', '#9b7bff', 'таймеры эффектов', 1], ['Notifications', '#34c759', 'баннеры', 0]] },
    { name: 'Гардероб', c: '#ff7ac0', i: S.crown, items: [['Крылья', '#ff7ac0', 'видят свои', 1], ['Нимб', '#ffd04d', 'над головой', 0], ['Питомец', '#ff9f43', 'рядом с тобой', 1], ['Машина с котом', '#4fd1ff', 'J — сесть', 0]] },
  ];
  let cur = 0;
  const catsEl = $('#winCats'), list = $('#winList'), title = $('#winTitle');
  catsEl.innerHTML = cats.map((c, i) => `<button class="cat${i === 0 ? ' on' : ''}" data-i="${i}"><b style="--c:${c.c}">${c.i}</b>${c.name}</button>`).join('');
  const render = () => {
    const c = cats[cur];
    title.textContent = c.name;
    list.innerHTML = c.items.map((it, j) => `<div class="mrow"><b style="--c:${it[1]}">${S.spark}</b><span>${it[0]}</span><small>${it[2]}</small><button class="sw${it[3] ? ' on' : ''}" data-j="${j}" aria-label="${it[0]}"></button></div>`).join('');
    $$('.sw', list).forEach(b => b.addEventListener('click', () => {
      const it = c.items[+b.dataset.j]; it[3] = it[3] ? 0 : 1; b.classList.toggle('on', !!it[3]);
    }));
  };
  $$('.cat', catsEl).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    if (i === cur) return;
    cur = i;
    $$('.cat', catsEl).forEach(x => x.classList.toggle('on', x === b));
    list.classList.add('swap');
    setTimeout(() => { render(); list.classList.remove('swap'); }, 180);
  }));
  render();
  // Набор в поиске — как в игре.
  const typed = $('#winTyped');
  const words = ['трейл', 'снег', 'тотем', 'прицел', 'эмоции'];
  let wi = 0, ci = 0, dir = 1;
  (function type() {
    const w = words[wi];
    ci += dir;
    typed.textContent = w.slice(0, ci);
    let wait = dir > 0 ? 120 : 55;
    if (ci >= w.length) { dir = -1; wait = 1400; }
    if (ci <= 0) { dir = 1; wi = (wi + 1) % words.length; wait = 500; }
    setTimeout(type, reduce ? 3000 : wait);
  })();
});

/* ═══════════ карточка: трейлы ═══════════ */
safe('trails', () => {
  const cv = $('#cvTrails'); const card = cv.closest('.card');
  const c2 = canvas2d(cv);
  let pts = [], hx = 0, hy = 0, tx = 0, ty = 0, hover = false, sparks = [], init = false;
  card.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; hover = true; });
  card.addEventListener('pointerleave', () => { hover = false; });
  loop(card, (t, dt) => {
    c2.begin();
    const { ctx, w, h } = c2;
    if (!hover) { tx = w * 0.5 + Math.sin(t * 1.05) * w * 0.33; ty = h * 0.48 + Math.sin(t * 1.9) * h * 0.26; }
    if (!init) { hx = tx; hy = ty; init = true; }
    const k = 1 - Math.exp(-dt * 10);
    hx += (tx - hx) * k; hy += (ty - hy) * k;
    pts.push([hx, hy]);
    if (pts.length > 70) pts.shift();
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = i / pts.length;
      ctx.strokeStyle = `hsla(${(250 - 45 * a).toFixed(0)},100%,${(58 + 14 * a).toFixed(0)}%,${(a * 0.6).toFixed(3)})`;
      ctx.lineWidth = 1 + a * 14;
      ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
    }
    for (let i = 1; i < pts.length; i++) {
      const a = i / pts.length;
      ctx.strokeStyle = `rgba(255,255,255,${(a * 0.55).toFixed(3)})`;
      ctx.lineWidth = 0.5 + a * 2.5;
      ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
    }
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 34);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.22, 'rgba(150,195,255,.75)'); g.addColorStop(1, 'rgba(90,120,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 34, 0, Math.PI * 2); ctx.fill();
    if (Math.random() < 0.6) sparks.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70, life: 1 });
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.3; }
    sparks = sparks.filter(s => s.life > 0);
    for (const s of sparks) { ctx.fillStyle = `rgba(180,210,255,${(s.life * 0.85).toFixed(3)})`; ctx.fillRect(s.x, s.y, 2, 2); }
    ctx.globalCompositeOperation = 'source-over';
  });
});

/* ═══════════ карточка: удары ═══════════ */
safe('hits', () => {
  const cv = $('#cvHits'); const card = cv.closest('.card');
  const c2 = canvas2d(cv);
  let FF = 'Geist, sans-serif';
  const readFont = () => { FF = getComputedStyle(document.body).fontFamily; };
  readFont();
  if (document.fonts) document.fonts.ready.then(readFont);
  let fx = [], nums = [], waves = [], flash = 0, hp = 20, lastHit = -10, nextAuto = 1, now = 0, shake = 0;
  const hit = (x, y) => {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 230;
      fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, life: 1, c: Math.random() < 0.5 ? '255,214,120' : '255,140,90' });
    }
    waves.push({ x, y, r: 6, life: 1 });
    const dmg = 1 + Math.random() * 4;
    nums.push({ x: x + (Math.random() - 0.5) * 24, y: y - 12, life: 1, text: '−' + dmg.toFixed(1).replace('.', ',') });
    hp -= dmg; if (hp <= 0) hp = 20;
    flash = 1; shake = 1; lastHit = now;
  };
  let geo = { cx: 0, cy: 0, s: 1 };
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect();
    hit(e.clientX - r.left, e.clientY - r.top);
  });
  cv.style.cursor = 'crosshair';
  const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };
  loop(card, (t, dt) => {
    now = t;
    c2.begin();
    const { ctx, w, h } = c2;
    ctx.clearRect(0, 0, w, h);
    const s = Math.max(3, Math.min(w, h) / 46);
    geo = { cx: w / 2, cy: h * 0.64, s };
    if (now - lastHit > 1.6 && now > nextAuto) { hit(geo.cx + (Math.random() - 0.5) * s * 6, geo.cy - s * 6 + (Math.random() - 0.5) * s * 4); nextAuto = now + 1.4; }
    // пол и тень
    const fl = ctx.createRadialGradient(geo.cx, geo.cy + s * 13, 0, geo.cx, geo.cy + s * 13, s * 16);
    fl.addColorStop(0, 'rgba(120,150,255,.22)'); fl.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = fl; ctx.fillRect(0, 0, w, h);
    // манекен из пикселей
    const kx = Math.sin(now * 60) * shake * s * 0.35;
    const x0 = geo.cx - s * 4 + kx, y0 = geo.cy - s * 14;
    const skin = '#e3bc9a', hoodie = '#5b5bd6', hoodie2 = '#4646b8', pants = '#2b2f55', hair = '#3a2416';
    px(ctx, x0, y0, s * 8, s * 8, skin);
    px(ctx, x0, y0, s * 8, s * 2, hair);
    px(ctx, x0 + s, y0 + s * 4, s, s, '#fff'); px(ctx, x0 + s * 2, y0 + s * 4, s, s, '#3b6fd6');
    px(ctx, x0 + s * 5, y0 + s * 4, s, s, '#3b6fd6'); px(ctx, x0 + s * 6, y0 + s * 4, s, s, '#fff');
    px(ctx, x0 + s * 3, y0 + s * 6, s * 2, s, '#a5674a');
    px(ctx, x0, y0 + s * 8, s * 8, s * 12, hoodie);
    px(ctx, x0 - s * 4, y0 + s * 8, s * 4, s * 12, hoodie2); px(ctx, x0 + s * 8, y0 + s * 8, s * 4, s * 12, hoodie2);
    px(ctx, x0 - s * 4, y0 + s * 18, s * 4, s * 2, skin); px(ctx, x0 + s * 8, y0 + s * 18, s * 4, s * 2, skin);
    px(ctx, x0, y0 + s * 20, s * 8, s * 7, pants);
    if (flash > 0) { ctx.fillStyle = `rgba(255,50,60,${(flash * 0.5).toFixed(3)})`; ctx.fillRect(x0 - s * 4, y0, s * 16, s * 27); }
    // мини-таргет над головой
    const bw = s * 16, bx = geo.cx - bw / 2, by = y0 - s * 5.2;
    ctx.fillStyle = 'rgba(14,16,28,.65)'; ctx.beginPath(); rr(ctx, bx - 8, by - 20, bw + 16, 34, 9); ctx.fill();
    ctx.fillStyle = '#f3f5fa'; ctx.font = `600 12px ${FF}`; ctx.textBaseline = 'middle'; ctx.fillText('Stardust_', bx, by - 8);
    const f = Math.max(0, hp / 20);
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(bx, by + 2, bw, 4);
    ctx.fillStyle = f > 0.6 ? '#34d399' : f > 0.3 ? '#ffb44a' : '#ff5f66'; ctx.fillRect(bx, by + 2, bw * f, 4);
    ctx.textAlign = 'right'; ctx.fillText(hp.toFixed(1), bx + bw, by - 8); ctx.textAlign = 'left';
    // волны, искры, урон
    ctx.globalCompositeOperation = 'lighter';
    for (const wv of waves) {
      wv.r += dt * 170; wv.life -= dt * 1.6;
      ctx.strokeStyle = `rgba(160,200,255,${Math.max(0, wv.life * 0.7).toFixed(3)})`; ctx.lineWidth = 2 + wv.life * 4;
      ctx.beginPath(); ctx.arc(wv.x, wv.y, wv.r, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of fx) {
      p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.5;
      ctx.fillStyle = `rgba(${p.c},${Math.max(0, p.life).toFixed(3)})`; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const n of nums) {
      n.y -= dt * 46; n.life -= dt * 0.9;
      ctx.fillStyle = `rgba(255,120,120,${Math.max(0, n.life).toFixed(3)})`;
      ctx.font = `700 ${Math.round(16 + 6 * (1 - n.life))}px ${FF}`;
      ctx.fillText(n.text, n.x, n.y);
    }
    waves = waves.filter(x => x.life > 0); fx = fx.filter(x => x.life > 0); nums = nums.filter(x => x.life > 0);
    flash = Math.max(0, flash - dt * 3.5); shake = Math.max(0, shake - dt * 5);
  });
});
function rr(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ═══════════ карточка: атмосфера ═══════════ */
safe('atmo', () => {
  const cv = $('#cvAtmo'); const card = cv.closest('.card');
  const c2 = canvas2d(cv);
  let hills = null, sprite = null, snow = [], flies = [];
  const build = (w, h) => {
    const d = c2.d;
    hills = document.createElement('canvas'); hills.width = Math.round(w * d); hills.height = Math.round(h * d);
    const g = hills.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const b = Math.max(5, Math.round(h / 34));
    for (let x = 0; x < w + b; x += b) {
      const n = 0.5 + 0.25 * Math.sin(x / w * 7.1 + 1.3) + 0.15 * Math.sin(x / w * 15.7) + 0.1 * Math.sin(x / w * 29.3 + 2);
      const y = Math.round((h * 0.7 - n * h * 0.2) / b) * b;
      g.fillStyle = '#03050d'; g.fillRect(x, y, b + 0.5, h - y);
      g.fillStyle = 'rgba(30,45,95,.55)'; g.fillRect(x, y + b, b + 0.5, b * 0.6);
      g.fillStyle = '#eaf2ff'; g.fillRect(x, y, b + 0.5, Math.max(2, b * 0.5));
      g.fillStyle = 'rgba(200,220,255,.45)'; g.fillRect(x, y + b * 0.5, b + 0.5, b * 0.3);
    }
    sprite = document.createElement('canvas'); sprite.width = 4; sprite.height = 128;
    const sg = sprite.getContext('2d'); const gr = sg.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(120,255,200,0)'); gr.addColorStop(0.55, 'rgba(110,255,190,.5)'); gr.addColorStop(0.8, 'rgba(120,170,255,.35)'); gr.addColorStop(1, 'rgba(160,110,255,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 4, 128);
    snow = Array.from({ length: 70 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: 0.6 + Math.random() * 1.6, v: 14 + Math.random() * 26, ph: Math.random() * 6 }));
    flies = Array.from({ length: 12 }, () => ({ x: Math.random() * w, y: h * (0.55 + Math.random() * 0.35), ph: Math.random() * 6, sp: 0.4 + Math.random() * 0.8 }));
  };
  loop(card, (t, dt) => {
    const changed = c2.begin();
    const { ctx, w, h } = c2;
    if (changed || !hills) build(w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#050816'); sky.addColorStop(0.6, '#0d1a44'); sky.addColorStop(1, '#16275a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    // луна
    const mx = w * 0.78, my = h * 0.2;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 60);
    mg.addColorStop(0, 'rgba(220,230,255,.35)'); mg.addColorStop(1, 'rgba(220,230,255,0)');
    ctx.fillStyle = mg; ctx.fillRect(mx - 60, my - 60, 120, 120);
    ctx.fillStyle = '#eef3ff'; ctx.beginPath(); ctx.arc(mx, my, 13, 0, Math.PI * 2); ctx.fill();
    // северное сияние
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      for (let x = -10; x < w + 10; x += 4) {
        const yy = h * (0.18 + band * 0.07) + Math.sin(x * 0.012 + t * (0.5 + band * 0.2) + band * 2) * 18 + Math.sin(x * 0.031 - t * 0.7) * 8;
        const hh = 70 + 30 * Math.sin(x * 0.02 + t + band);
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(x * 0.015 + t * 1.3 + band);
        ctx.drawImage(sprite, x, yy - hh * 0.7, 5, hh);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(hills, 0, 0, w, h);
    // снег
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of snow) {
      f.y += f.v * dt; f.x += Math.sin(t + f.ph) * 8 * dt;
      if (f.y > h) { f.y = -4; f.x = Math.random() * w; }
      ctx.globalAlpha = 0.5 + 0.5 * (f.r / 2.2);
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // светлячки
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      const x = f.x + Math.sin(t * f.sp + f.ph) * 22, y = f.y + Math.cos(t * f.sp * 1.3 + f.ph) * 12;
      const a = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2 * f.sp + f.ph * 3));
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
      g.addColorStop(0, `rgba(255,236,150,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 12, y - 12, 24, 24);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
});

/* ═══════════ карточка: гардероб на орбите ═══════════ */
safe('orbit', () => {
  const box = $('#orbit');
  $('#orbAvatar').innerHTML = face(23);
  const items = [
    ['Корона', '<svg viewBox="0 0 24 24"><defs><linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe58a"/><stop offset="1" stop-color="#f0a92a"/></linearGradient></defs><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5Z" fill="url(#gd)"/><circle cx="12" cy="14.5" r="1.6" fill="#ff5f66"/></svg>'],
    ['Крылья', '<svg viewBox="0 0 24 24" fill="#eef3ff"><path d="M11 7C7 4 3 4 1.5 6c2.5.3 3.4 1.3 3.8 2.6C3.6 8.7 2.6 9.6 2.4 11c2-.6 3.4-.4 4.4.4-.9.8-1.3 1.9-1.1 3.2 1.8-1.4 3.9-2 5.3-1.8Z"/><path d="M13 7c4-3 8-3 9.5-1-2.5.3-3.4 1.3-3.8 2.6 1.7.1 2.7 1 2.9 2.4-2-.6-3.4-.4-4.4.4.9.8 1.3 1.9 1.1 3.2-1.8-1.4-3.9-2-5.3-1.8Z"/></svg>'],
    ['Нимб', '<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12" rx="9" ry="4" stroke="#ffe27a" stroke-width="2.4"/><ellipse cx="12" cy="12" rx="9" ry="4" stroke="#fff6c8" stroke-width=".8"/></svg>'],
    ['Шляпа', '<svg viewBox="0 0 24 24"><rect x="7" y="4" width="10" height="11" rx="1.5" fill="#2a2d3a"/><rect x="7" y="11.5" width="10" height="2" fill="#ff5f66"/><rect x="3" y="15" width="18" height="3" rx="1.5" fill="#3a3e4f"/></svg>'],
    ['Питомец', '<svg viewBox="0 0 24 24" fill="#ffb067"><circle cx="7" cy="9" r="2.2"/><circle cx="12" cy="6.8" r="2.2"/><circle cx="17" cy="9" r="2.2"/><path d="M12 11.5c3.2 0 5.5 3.3 5.5 5.4 0 1.6-1.4 2.4-2.8 2.1-1-.2-1.7-.7-2.7-.7s-1.7.5-2.7.7c-1.4.3-2.8-.5-2.8-2.1 0-2.1 2.3-5.4 5.5-5.4Z"/></svg>'],
    ['Машина с котом', '<svg viewBox="0 0 24 24"><path d="M3 15.5V13c0-1 .7-1.7 1.6-1.8l2.4-.3 2-3c.4-.6 1-.9 1.7-.9h3.8c.7 0 1.3.3 1.7.9l1.8 2.8 1.5.4c.9.3 1.5 1.1 1.5 2v2.4Z" fill="#ff5f66"/><circle cx="7.5" cy="16" r="2.2" fill="#1d1f2b"/><circle cx="16.5" cy="16" r="2.2" fill="#1d1f2b"/><path d="M10.5 5.5 11 4l1 1h1l1-1 .5 1.5" fill="none" stroke="#ffd04d" stroke-width="1.2" stroke-linejoin="round"/></svg>'],
    ['120 мечей', '<svg viewBox="0 0 24 24"><path d="M20 3 10 13l1.5 1.5L21.5 4.5V3Z" fill="#7ee2f0"/><path d="m5.5 13.5 5 5-1.5 1.5-5-5Z" fill="#6b4a2a"/><path d="M5 17 3 19l2 2 2-2Z" fill="#3a2a1a"/></svg>'],
  ];
  const sats = items.map(([name, svg]) => {
    const el = document.createElement('div');
    el.className = 'sat';
    el.innerHTML = svg + `<em>${name}</em>`;
    box.appendChild(el);
    return el;
  });
  let a = 0, speed = 0.32, hoverSat = false;
  sats.forEach(s => { s.addEventListener('pointerenter', () => hoverSat = true); s.addEventListener('pointerleave', () => hoverSat = false); });
  loop(box, (t, dt) => {
    const target = hoverSat || reduce ? 0 : 0.32;
    speed += (target - speed) * Math.min(1, dt * 4);
    a += speed * dt;
    const w = box.clientWidth, h = box.clientHeight;
    const rx = Math.min(w * 0.40, 230), ry = Math.min(h * 0.20, 58);
    const cx = w / 2, cy = h * 0.47;
    sats.forEach((s, i) => {
      const ang = a + i / sats.length * Math.PI * 2;
      const z = Math.sin(ang);
      const x = cx + Math.cos(ang) * rx, y = cy + z * ry + 16;
      const k = 0.72 + 0.32 * (z + 1) / 2;
      s.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${k.toFixed(3)})`;
      s.style.zIndex = z > 0 ? 10 : 1;
      s.style.opacity = (0.45 + 0.55 * (z + 1) / 2).toFixed(3);
      s.style.filter = z < -0.3 ? `blur(${((-z - 0.3) * 2.2).toFixed(2)}px)` : 'none';
    });
  });
});

/* ═══════════ карточка: FPS ═══════════ */
safe('fps', () => {
  const card = $('#fpsChart').closest('.card');
  const num = $('#fpsNum'), line = $('#fpsLine'), area = $('#fpsArea'), btn = $('#optBtn'), sw = $('#optSw');
  let on = false, val = 148, acc = 0;
  const pts = Array.from({ length: 48 }, (_, i) => 148 + Math.sin(i * 0.6) * 9 + Math.random() * 6);
  btn.addEventListener('click', () => { on = !on; sw.classList.toggle('on', on); btn.setAttribute('aria-checked', String(on)); });
  const drawChart = () => {
    const W = 400, H = 130, lo = 90, hi = 270;
    const p = pts.map((v, i) => [i / (pts.length - 1) * W, H - (v - lo) / (hi - lo) * H]);
    let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    for (let i = 1; i < p.length; i++) {
      const [x0, y0] = p[i - 1], [x1, y1] = p[i];
      const mx = (x0 + x1) / 2;
      d += ` C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    line.setAttribute('d', d);
    area.setAttribute('d', d + ` L${W} ${H} L0 ${H} Z`);
  };
  drawChart();
  loop(card, (t, dt) => {
    const target = on ? 240 : 148;
    acc += dt;
    if (acc > 0.12) {
      acc = 0;
      const last = pts[pts.length - 1];
      pts.shift();
      pts.push(lerp(last, target + (Math.random() - 0.5) * (on ? 14 : 26), 0.35));
      drawChart();
    }
    val += (pts[pts.length - 1] - val) * Math.min(1, dt * 6);
    num.textContent = Math.round(val);
  });
});

/* ═══════════ карточка: сеть ═══════════ */
safe('net', () => {
  const box = $('#net');
  const W = 700, H = 320;
  const nodes = [[350, 165, 1], [120, 90], [585, 80], [95, 245], [610, 250], [255, 270], [460, 60], [470, 285]];
  const links = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 3], [2, 6], [4, 7], [5, 7]];
  const pix = (seed, size) => {
    const svg = face(seed).replace('<svg viewBox="0 0 8 8" shape-rendering="crispEdges">', '').replace('</svg>', '');
    return `<g transform="scale(${size / 8})" shape-rendering="crispEdges">${svg}</g>`;
  };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Игроки Nebula, связанные в сеть"><defs>
    <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5fb2ff" stop-opacity=".15"/><stop offset=".5" stop-color="#9b7bff" stop-opacity=".55"/><stop offset="1" stop-color="#5fb2ff" stop-opacity=".15"/></linearGradient>
    <radialGradient id="ng"><stop offset="0" stop-color="#7fb2ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fb2ff" stop-opacity="0"/></radialGradient>`;
  nodes.forEach((n, i) => { const r = n[2] ? 15 : 11; s += `<clipPath id="cp${i}"><rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${n[2] ? 9 : 7}"/></clipPath>`; });
  s += '</defs>';
  links.forEach(([a, b]) => { s += `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="url(#ln)" stroke-width="1.2"/>`; });
  links.forEach((_, i) => { s += `<circle class="pulse" data-l="${i}" r="2.6" fill="#cfe2ff"/>`; });
  nodes.forEach((n, i) => {
    const r = n[2] ? 15 : 11, size = r * 2;
    s += `<g transform="translate(${n[0]},${n[1]})"><circle r="${r * 2.6}" fill="url(#ng)" opacity="${n[2] ? 0.9 : 0.5}"/>`
      + `<rect x="${-r - 2}" y="${-r - 2}" width="${size + 4}" height="${size + 4}" rx="${n[2] ? 11 : 9}" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,${n[2] ? 0.5 : 0.22})"/>`
      + `<g clip-path="url(#cp${i})"><g transform="translate(${-r},${-r})">${pix(i * 13 + 3, size)}</g></g></g>`;
  });
  s += '</svg>';
  box.innerHTML = s;
  const svg = box.querySelector('svg');
  const pulses = $$('.pulse', svg).map((el, i) => ({ el, t: Math.random(), sp: 0.25 + Math.random() * 0.35, dir: Math.random() < 0.5 ? 1 : -1, l: links[i] }));
  const emotes = ['👋', '🔥', '⭐', '😄', '💙', '✨'];
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  box.appendChild(bubble);
  let nextEmote = 1;
  loop(box, (t, dt) => {
    for (const p of pulses) {
      p.t += p.sp * dt * p.dir;
      if (p.t > 1) { p.t = 0; } else if (p.t < 0) { p.t = 1; }
      const a = nodes[p.l[0]], b = nodes[p.l[1]];
      p.el.setAttribute('cx', lerp(a[0], b[0], p.t).toFixed(1));
      p.el.setAttribute('cy', lerp(a[1], b[1], p.t).toFixed(1));
      p.el.setAttribute('opacity', (Math.sin(p.t * Math.PI) * 0.9).toFixed(2));
    }
    if (t > nextEmote) {
      nextEmote = t + 2.2;
      const n = nodes[1 + Math.floor(Math.random() * (nodes.length - 1))];
      const r = svg.getBoundingClientRect(), br = box.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H);
      const ox = r.left - br.left + (r.width - W * k) / 2, oy = r.top - br.top + (r.height - H * k) / 2;
      bubble.textContent = emotes[Math.floor(Math.random() * emotes.length)];
      bubble.style.left = (ox + n[0] * k + 6) + 'px';
      bubble.style.top = (oy + n[1] * k - 8) + 'px';
      bubble.classList.add('show');
      setTimeout(() => bubble.classList.remove('show'), 1500);
    }
  });
});

/* ═══════════ лаунчер ═══════════ */
safe('launcher', () => {
  const wrap = $('#deviceWrap'), dev = $('#device');
  seg($('#lnSeg'), v => dev.classList.toggle('dark', v === 'dark'));
  const upd = () => {
    const r = wrap.getBoundingClientRect(), vh = innerHeight;
    const e = easeOut(clamp((vh - r.top) / (vh * 0.9)));
    dev.style.setProperty('--rx', (24 * (1 - e)).toFixed(2) + 'deg');
    dev.style.setProperty('--sc', (0.88 + 0.12 * e).toFixed(4));
    dev.style.setProperty('--ty', (50 * (1 - e)).toFixed(1) + 'px');
  };
  let pending = false;
  addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; upd(); }); } }, { passive: true });
  addEventListener('resize', upd);
  upd();
});

/* ═══════════ функции: поиск как Spotlight ═══════════ */
safe('modules', () => {
  const CATS = { visual: ['Визуалы', '#4d8dff'], hud: ['HUD', '#30b0c7'], world: ['Мир', '#34c759'], cosm: ['Гардероб', '#ff6fa8'], util: ['Утилиты', '#ff9f43'], net: ['Сеть', '#9b7bff'] };
  const G = {
    visual: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14.2 9.8 21.5 12l-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2Z"/></svg>',
    hud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="M3 9.5h18"/></svg>',
    world: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 15.2A9 9 0 0 1 8.8 4.5a9 9 0 1 0 10.7 10.7Z"/></svg>',
    cosm: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5Z"/></svg>',
    util: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 3.6a5 5 0 0 0-6.4 6.4L3.6 14.7a1.9 1.9 0 0 0 2.7 2.7l4.7-4.7a5 5 0 0 0 6.4-6.4L14.8 8.9 13 8.4l-.5-1.8Z"/></svg>',
    net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M6.8 6.8a7.4 7.4 0 0 0 0 10.4M17.2 6.8a7.4 7.4 0 0 1 0 10.4"/></svg>',
  };
  const M = [
    ['Ambience', 'world', 'Время, погода, своё небо, туман, мокрый мир, зима, Новый год и светлячки.', 'амбиенс погода небо снег'],
    ['Fullbright', 'world', 'Убирает темноту: пещера видна как днём.', 'фулбрайт яркость'],
    ['World Particles', 'world', 'Свои частицы в мире вокруг.', 'частицы'],
    ['Loot Beams', 'world', 'Столбы света над выпавшими вещами — цветом по ценности.', 'лут лучи'],
    ['Death Point', 'world', 'Луч на месте смерти, путь до него и сколько ещё пролежат вещи.', 'смерть точка'],
    ['Invisible Blocks', 'world', 'Показывает блоки, которые сервер прячет.', 'невидимые блоки'],
    ['Block Timers', 'world', 'Таймер над трапками и пластами: сколько им осталось.', 'таймеры трапка'],
    ['TNT Timer', 'world', 'Таймер над динамитом до взрыва.', 'динамит тнт'],
    ['Item Physics', 'world', 'Предметы на земле лежат плашмя и катаются.', 'физика предметов'],
    ['Trails', 'visual', 'След за игроками и снарядами.', 'трейлы след'],
    ['Jump Circle', 'visual', 'Круг под ногами в момент прыжка.', 'прыжок круг'],
    ['Hit Particles', 'visual', 'Искры в точке попадания.', 'искры удар'],
    ['Hit Bubbles', 'visual', 'Волна искажения в месте удара.', 'волна удар'],
    ['Kill Effects', 'visual', 'Вспышка на месте добитого: душа, снег, тыквы или конфетти.', 'убийство эффект'],
    ['Totem Effects', 'visual', 'Вспышка в момент, когда тотем спасает.', 'тотем'],
    ['Block Overlay', 'visual', 'Подсветка блока, на который смотришь.', 'блок подсветка'],
    ['Hand Shader', 'visual', 'Подсветка руки и предмета в ней.', 'рука шейдер'],
    ['Swing Animation', 'visual', 'Своя анимация взмаха и её скорость.', 'анимация взмах'],
    ['View Model', 'visual', 'Где держать предмет в руке и под каким углом.', 'вьюмодел рука'],
    ['Custom Swords', 'visual', '120 моделей вместо ванильных мечей. Видно только тебе.', 'мечи модели'],
    ['Crosshair', 'visual', 'Свой прицел: открывается на кулдауне, краснеет на цели.', 'прицел'],
    ['Hitboxes', 'visual', 'Подсвечивает хитбоксы игроков, мобов и предметов.', 'хитбоксы'],
    ['Nametags', 'visual', 'Плашки игроков со здоровьем и бронёй.', 'ники плашки'],
    ['Target ESP', 'visual', 'Метка на том, с кем дерёшься.', 'цель метка'],
    ['HP Counter', 'visual', 'Над игроками всплывают числа урона и лечения.', 'хп урон'],
    ['Motion Blur', 'visual', 'Размытие в движении камеры.', 'моушн блюр'],
    ['Color Correction', 'visual', 'Контраст, насыщенность и температура картинки.', 'цвет коррекция'],
    ['Aspect Ratio', 'visual', 'Сужает кадр полосами сверху и снизу.', 'соотношение сторон кино'],
    ['Removals', 'visual', 'Выключает тряску, виньетку и погоду.', 'удаление тряска'],
    ['China Hat', 'visual', 'Конус над головой — себе и друзьям.', 'шляпа конус'],
    ['HUD', 'hud', 'Панели поверх игры: что показывать и где они лежат.', 'худ панели'],
    ['Notifications', 'hud', 'Всплывающие сообщения о том, что стоит заметить.', 'уведомления'],
    ['GPS', 'hud', 'Метка места, куда вернуться, с расстоянием.', 'гпс метка'],
    ['Saturation Bar', 'hud', 'Полоса насыщения под шкалой голода.', 'насыщение'],
    ['Shulker Preview', 'hud', 'Содержимое шалкера без открытия.', 'шалкер'],
    ['Totem Alert', 'hud', 'Говорит, когда у противника сработал тотем.', 'тотем алерт'],
    ['Theme', 'hud', 'Цвет, которым выкрашен весь интерфейс.', 'тема цвет'],
    ['Customization', 'cosm', 'Корона, шляпа или нимб, крылья, козёл на плече.', 'косметика корона крылья'],
    ['Custom Pet', 'cosm', 'Питомец рядом с тобой.', 'питомец пет'],
    ['Companion Car', 'cosm', 'Машина с котом на капоте: J — сесть и ехать.', 'машина кот'],
    ['Self Tag', 'cosm', 'Твой ник над головой от третьего лица.', 'ник'],
    ['Emotions', 'net', 'Колесо эмоций, которые видят игроки Nebula.', 'эмоции'],
    ['Party', 'net', 'Команда из игроков Nebula и метки по бинду.', 'пати команда'],
    ['Portal Live', 'net', 'Живой портал: ты и тиммейт видите друг друга.', 'портал'],
    ['Presence', 'net', 'Значок Nebula у тех, кто играет прямо сейчас.', 'онлайн значок'],
    ['Discord RPC', 'net', 'Показывает в Discord, что ты играешь с модом.', 'дискорд'],
    ['Lyrics Text', 'net', 'Текст песни из Spotify или Яндекс Музыки в мире вокруг.', 'песня текст музыка'],
    ['Freelook', 'util', 'Камера осматривается свободно, пока зажата клавиша.', 'фрилук камера'],
    ['Auto Sprint', 'util', 'Держит бег включённым.', 'спринт бег'],
    ['Elytra Swap', 'util', 'Меняет элитру на нагрудник по клавише.', 'элитры'],
    ['Auto Totem', 'util', 'Берёт тотем в руку на пороге здоровья.', 'автототем'],
    ['Item Scroller', 'util', 'Перекладывает предметы колесом и перетаскиванием.', 'предметы'],
    ['Auction Helper', 'util', 'Подсвечивает самые дешёвые лоты аукциона.', 'аукцион'],
    ['Name Protect', 'util', 'Прячет ники на записи и стриме.', 'стрим ник'],
    ['Hide Password', 'util', 'Пароль /login в чате — звёздочками.', 'пароль'],
    ['Optimizer', 'util', 'Срезает то, что стоит кадров и не видно.', 'оптимизация фпс'],
    ['Auto Respawn', 'util', 'Возрождает сам после смерти.', 'респавн'],
    ['GUI Move', 'util', 'Ходить, пока открыто меню мода.', 'движение меню'],
  ];
  // Сначала вперемешку по разделам — первые карточки показывают всё разнообразие.
  const order = Object.keys(CATS);
  const byCat = order.map(c => M.filter(m => m[1] === c));
  const mixed = [];
  while (byCat.some(a => a.length)) byCat.forEach(a => { if (a.length) mixed.push(a.shift()); });

  const LIMIT = 12;
  let cat = 'all', expanded = false;
  const tabs = $('#tabs'), list = $('#mods'), more = $('#more'), q = $('#q');
  tabs.innerHTML = [['all', 'Все']].concat(order.map(k => [k, CATS[k][0]]))
    .map(([k, n]) => `<button class="pill-btn${k === 'all' ? ' on' : ''}" data-c="${k}">${n}</button>`).join('');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.c;
    $$('.pill-btn', tabs).forEach(x => x.classList.toggle('on', x === b));
    render();
  });
  const LAT = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
  const RUS = 'йцукенгшщзхъфывапролджэячсмитьбю';
  // Чужая раскладка в обе стороны: «nhtqk» → «трейл», «фьи» → «amb».
  const toRus = s => s.replace(/[a-z\[\];',.]/g, ch => RUS[LAT.indexOf(ch)] || ch);
  const toLat = s => s.replace(/[а-яё]/g, ch => LAT[RUS.indexOf(ch === 'ё' ? 'е' : ch)] || ch);
  const esc = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const markName = (name, needle) => {
    if (!needle) return esc(name);
    const i = name.toLowerCase().indexOf(needle);
    return i < 0 ? esc(name) : esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + needle.length)) + '</mark>' + esc(name.slice(i + needle.length));
  };
  const match = (m, needle) => {
    if (!needle) return true;
    const hay = (m[0] + ' ' + m[2] + ' ' + m[3]).toLowerCase();
    const initials = m[0].split(/\s+/).map(w => w[0]).join('').toLowerCase();
    return [needle, toRus(needle), toLat(needle)].some(v => hay.includes(v) || initials.startsWith(v));
  };
  function render() {
    const needle = q.value.trim().toLowerCase();
    const found = mixed.filter(m => (cat === 'all' || m[1] === cat) && match(m, needle));
    const cut = !expanded && !needle && cat === 'all' && found.length > LIMIT;
    const shown = cut ? found.slice(0, LIMIT) : found;
    more.hidden = !cut;
    list.innerHTML = shown.length ? shown.map((m, i) => {
      const c = CATS[m[1]];
      return `<div class="mod" style="--d:${Math.min(i, 14) * 0.025}s"><span class="ic" style="--c:${c[1]}">${G[m[1]]}</span><div><b>${markName(m[0], needle)}</b><span>${esc(m[2])}</span></div></div>`;
    }).join('') : `<div class="empty">Ничего не нашлось — попробуй по-другому</div>`;
  }
  q.addEventListener('input', render);
  more.addEventListener('click', () => { expanded = true; render(); });
  render();

  // Подсказки в поле — печатаются сами, пока поле пустое и не в фокусе.
  const ideas = ['Трейлы', 'снег на блоках', 'тотем', 'прицел', 'машина с котом', 'светлячки'];
  let ii = 0, ci = 0, dir = 1;
  (function type() {
    if (document.activeElement === q || q.value) { q.placeholder = 'Найти функцию…'; setTimeout(type, 800); return; }
    const w = ideas[ii];
    ci += dir;
    q.placeholder = w.slice(0, Math.max(0, ci)) + (ci > 0 ? '' : '');
    let wait = dir > 0 ? 95 : 45;
    if (ci >= w.length) { dir = -1; wait = 1600; }
    if (ci <= 0) { dir = 1; ii = (ii + 1) % ideas.length; wait = 400; }
    setTimeout(type, reduce ? 2500 : wait);
  })();
});

/* ═══════════ скачать: звёзды в карточке ═══════════ */
safe('dlstars', () => {
  const cv = $('#dlStars'); if (!cv) return;
  const c2 = canvas2d(cv);
  let stars = [];
  loop(cv.closest('.dl'), (t, dt) => {
    const changed = c2.begin();
    const { ctx, w, h } = c2;
    if (changed || !stars.length) stars = Array.from({ length: Math.round(w * h / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.3, ph: Math.random() * 6, sp: 0.6 + Math.random() * 1.6 }));
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(t * s.sp + s.ph));
      ctx.fillStyle = `rgba(200,220,255,${(a * 0.8).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      s.y -= dt * 4 * s.r; if (s.y < -2) { s.y = h + 2; s.x = Math.random() * w; }
    }
  });
});

/* ═══════════ вопросы ═══════════ */
safe('faq', () => {
  const FAQ = [
    ['На каких версиях работает?', 'Minecraft 1.21.4 и 1.21.11 на Fabric. Версию выбираешь в лаунчере одним меню — он сам ставит нужную сборку.'],
    ['Как обновлять мод?', 'Никак: лаунчер сам находит новую сборку мода и скачивает её. Сам лаунчер тоже обновляется сам.'],
    ['Кто видит мою косметику?', 'Все, кто играет с Nebula. Обычные игроки видят тебя как обычно — без крыльев и короны.'],
    ['Можно ли подвинуть и уменьшить HUD?', 'Да: каждую панель можно перетащить, изменить размер и выключить в редакторе HUD. Цвет, стекло и прозрачность — в теме.'],
    ['Мод снизит FPS?', 'Эффекты считаются на видеокарте, а Optimizer срезает то, что не видно. Тяжёлые эффекты можно выключать по одному.'],
    ['Нужна ли Java?', 'Нет: Java для игры приходит вместе с лаунчером, отдельно ставить ничего не нужно.'],
    ['Есть светлая тема?', 'У лаунчера — светлая, тёмная и «как в Windows». У меню мода — тоже светлое, тёмное и «Авто» по времени суток в мире.'],
    ['Что такое Portal Live?', 'Живой портал по клавише: ты и тиммейт с одинаковым кодом комнаты видите друг друга в реальном времени. Или зеркало — только на себя.'],
  ];
  const box = $('#faqList');
  const plus = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 1.5v9M1.5 6h9"/></svg>';
  box.innerHTML = FAQ.map(([qq, a], i) => `<div class="qa" data-r style="--d:${(i % 4) * 0.05}s"><button aria-expanded="false" aria-controls="ans${i}" id="q${i}">${qq}<span class="pm">${plus}</span></button><div class="ans" id="ans${i}" role="region" aria-labelledby="q${i}"><div><p>${a}</p></div></div></div>`).join('');
  $$('.qa', box).forEach(el => {
    const b = el.querySelector('button');
    b.addEventListener('click', () => { const open = !el.classList.contains('open'); el.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open)); });
  });
  const ob = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); ob.unobserve(e.target); } }), { threshold: 0.1 });
  $$('[data-r]', box).forEach(el => ob.observe(el));
});

/* ═══════════ свежая версия с GitHub ═══════════ */
safe('release', () => {
  fetch('https://api.github.com/repos/s3lfcode1337-lang/nebula-launcher/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(rel => {
      const tag = String(rel.tag_name || '').replace(/^v/, '');
      if (!tag) return;
      $('#navVer').textContent = 'v' + tag;
      const date = new Date(rel.published_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
      $('#dlTag').innerHTML = `<i></i>Версия ${tag} · ${date}`;
      const zip = (rel.assets || []).find(a => /\.zip$/i.test(a.name));
      if (zip) {
        $('#dlZip').href = zip.browser_download_url;
        const mb = Math.round(zip.size / 1048576);
        $('#dlSize').lastChild.textContent = `63 КБ, затем ~${mb} МБ`;
      }
    })
    .catch(() => {});
});

})();
