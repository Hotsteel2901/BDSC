import * as THREE from 'three';

/**
 * AsciiComposer
 * -------------
 * Renders a three.js scene to an offscreen HDR-ish target, then resolves it into
 * a grid of ASCII glyphs via a full-screen shader. Lighting/colour from the real
 * 3D scene is preserved and used to tint the glyphs, while a density-ordered
 * character ramp + Sobel edge detection produce crisp, unified ASCII art.
 */

// Density-ordered ramp. Index 0 = darkest, last = brightest.
export const DEFAULT_RAMP =
  ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

// A second ramp that leans on symbols for a more "terminal" look.
export const SYMBOL_RAMP =
  ' .-:~=+*ox%#@';

export class AsciiComposer {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.charSize = opts.charSize || 11;     // cell size in screen px
    this.resMult = opts.resMult || 4;        // internal pixels per cell (AA for small bright features)
    this.color = opts.color !== false;       // tint glyphs with scene colour
    this.edge = opts.edge !== false;         // sobel edge -> outline glyphs
    this.contrast = opts.contrast ?? 1.15;
    this.brightness = opts.brightness ?? 2.05;
    this.saturation = opts.saturation ?? 1.18;
    this.gamma = opts.gamma ?? 0.4545; // linear -> sRGB (1/2.2)
    this.ramp = opts.ramp || DEFAULT_RAMP;
    this.fg = new THREE.Color(opts.fg || 0x9dffbf);
    this.bg = new THREE.Color(opts.bg || 0x03060a);
    this.enabled = opts.enabled !== false;
    this.fx = {
      scanline: opts.scanline ?? 0.10,
      vignette: opts.vignette ?? 0.26,
      bloom: opts.bloom ?? 0.34,
      aberration: opts.aberration ?? 0.9,
      noise: opts.noise ?? 0.045,
      flicker: opts.flicker ?? 0.015,
    };

    this.fontTexture = makeFontAtlas(this.ramp, 32);
    this.fontCols = this.fontTexture.userData.cols;
    this.fontRows = this.fontTexture.userData.rows;

    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    // Full-res bright pass (for cheap bloom) reused between frames.
    this.brightRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBright: { value: null },
        tFont: { value: this.fontTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCharSize: { value: this.charSize },
        uFontCols: { value: this.fontCols },
        uFontRows: { value: this.fontRows },
        uRampLen: { value: this.ramp.length },
        uColor: { value: this.color ? 1 : 0 },
        uEdge: { value: this.edge ? 1 : 0 },
        uContrast: { value: this.contrast },
        uBrightness: { value: this.brightness },
        uSaturation: { value: this.saturation },
        uGamma: { value: this.gamma },
        uFg: { value: new THREE.Vector3(this.fg.r, this.fg.g, this.fg.b) },
        uBg: { value: new THREE.Vector3(this.bg.r, this.bg.g, this.bg.b) },
        uTime: { value: 0 },
        uScanline: { value: this.fx.scanline },
        uVignette: { value: this.fx.vignette },
        uBloom: { value: this.fx.bloom },
        uAberration: { value: this.fx.aberration },
        uNoise: { value: this.fx.noise },
        uFlicker: { value: this.fx.flicker },
        uHit: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene;
        uniform sampler2D tBright;
        uniform sampler2D tFont;
        uniform vec2 uResolution;
        uniform float uCharSize;
        uniform float uFontCols;
        uniform float uFontRows;
        uniform float uRampLen;
        uniform float uColor;
        uniform float uEdge;
        uniform float uContrast;
        uniform float uBrightness;
        uniform float uSaturation;
        uniform float uGamma;
        uniform vec3 uFg;
        uniform vec3 uBg;
        uniform float uTime;
        uniform float uScanline;
        uniform float uVignette;
        uniform float uBloom;
        uniform float uAberration;
        uniform float uNoise;
        uniform float uFlicker;
        uniform float uHit;

        float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        // Full colour grade pipeline (brightness → contrast → saturation →
        // highlight rolloff → gamma). Factored out so several texels per cell
        // can be graded and the brightest one chosen.
        vec3 grade(vec3 c){
          c *= uBrightness;
          c = (c - 0.5) * uContrast + 0.5;
          float l = luma(c);
          c = mix(vec3(l), c, uSaturation);
          c = max(c, vec3(0.0));
          vec3 over = max(c - 0.45, vec3(0.0));
          c = min(c, vec3(0.45)) + over / (1.0 + over * 2.5);
          return pow(c, vec3(uGamma));
        }

        float hash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main(){
          float cell = uCharSize;
          vec2 px = vUv * uResolution;
          vec2 cellIdx = floor(px / cell);
          vec2 cellUv = fract(px / cell);

          // sample the scene at the centre of the cell
          vec2 sampleUv = (cellIdx * cell + cell * 0.5) / uResolution;

          // chromatic aberration
          vec2 ca = (cellUv - 0.5) * (uAberration / uResolution) * 2.0;
          vec3 col;
          col.r = texture2D(tScene, sampleUv + ca).r;
          col.g = texture2D(tScene, sampleUv).g;
          col.b = texture2D(tScene, sampleUv - ca).b;

          // edge detection across neighbouring cells (luminance sobel)
          float edgeAmt = 0.0;
          if (uEdge > 0.5) {
            vec2 t = vec2(cell) / uResolution;
            float l = luma(texture2D(tScene, sampleUv - vec2(t.x, 0.0)).rgb);
            float r = luma(texture2D(tScene, sampleUv + vec2(t.x, 0.0)).rgb);
            float u = luma(texture2D(tScene, sampleUv - vec2(0.0, t.y)).rgb);
            float d = luma(texture2D(tScene, sampleUv + vec2(0.0, t.y)).rgb);
            edgeAmt = clamp(length(vec2(r - l, d - u)) * 2.4, 0.0, 1.0);
          }

          // grade — and let the brightest texel within the cell footprint win,
          // so thin/small bright features (enemy markers, tracers, flashes) are
          // not lost to a single unlucky centre sample.
          // Pick the brightest raw texel in the cell footprint, then grade only
          // the centre and that winner (cheap) so small bright features survive
          // without flattening the moody base art.
          vec3 rawPeak = col; float rawL = luma(col); float peakFound = 0.0;
          {
            vec2 off = vec2(cell * 0.42) / uResolution;
            vec3 s;
            s = texture2D(tScene, sampleUv + vec2(off.x, 0.0)).rgb; float sl = luma(s); if (sl > rawL) { rawL = sl; rawPeak = s; peakFound = 1.0; }
            s = texture2D(tScene, sampleUv - vec2(off.x, 0.0)).rgb; sl = luma(s); if (sl > rawL) { rawL = sl; rawPeak = s; peakFound = 1.0; }
            s = texture2D(tScene, sampleUv + vec2(0.0, off.y)).rgb; sl = luma(s); if (sl > rawL) { rawL = sl; rawPeak = s; peakFound = 1.0; }
            s = texture2D(tScene, sampleUv - vec2(0.0, off.y)).rgb; sl = luma(s); if (sl > rawL) { rawL = sl; rawPeak = s; peakFound = 1.0; }
          }
          col = grade(col);
          float l = luma(col);
          if (peakFound > 0.5) {
            vec3 gp = grade(rawPeak); float gl = luma(gp);
            float adopt = smoothstep(0.08, 0.30, gl - l);
            col = mix(col, gp, adopt);
            l = mix(l, gl, adopt);
          }

          // add a touch of the bright pass (bloom) to luminance only
          float bloom = luma(texture2D(tBright, sampleUv).rgb);
          l += bloom * uBloom;
          edgeAmt = max(edgeAmt, bloom * 0.7);

          // choose glyph
          float lum = clamp(l + edgeAmt * 0.85, 0.0, 1.0);
          float idx = floor(lum * (uRampLen - 1.0) + 0.001);

          // prefer a crisp structural glyph on strong edges
          if (edgeAmt > 0.55) {
            idx = max(idx, floor(uRampLen * 0.72));
          }

          float gx = mod(idx, uFontCols);
          float gy = floor(idx / uFontCols);
          vec2 glyphUv = (vec2(gx, gy) + cellUv) / vec2(uFontCols, uFontRows);
          float glyph = texture2D(tFont, glyphUv).r;

          // glyphs with detail stay readable thanks to 4x downscale AA
          vec3 outCol = mix(vec3(1.0), col, uColor);
          outCol = mix(uFg * (0.55 + l * 0.9), outCol, uColor);
          vec3 ink = uBg;
          vec3 rgb = mix(ink, outCol, glyph);

          // subtle additive glow from bloom
          rgb += outCol * bloom * uBloom * 0.2;

          // screen effects
          float scan = 1.0 - uScanline * step(0.5, fract(px.y * 0.5));
          rgb *= scan;

          float vign = smoothstep(0.95, 0.35, length(vUv - 0.5));
          rgb *= mix(1.0, vign, uVignette);

          float n = (hash(px + uTime) - 0.5) * uNoise;
          rgb += n;

          float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 60.0));
          rgb *= flick;

          // damage vignette
          rgb = mix(rgb, vec3(0.9, 0.05, 0.15), uHit * smoothstep(0.2, 0.7, length(vUv - 0.5)));

          gl_FragColor = vec4(rgb, 1.0);
        }
      `,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // Bright-pass extraction material (for bloom)
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: 0.98 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tScene; uniform float uThreshold;
        void main(){
          vec3 c = texture2D(tScene, vUv).rgb;
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          float k = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.001);
          gl_FragColor = vec4(c * k, 1.0);
        }
      `,
    });
    this.brightQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.brightQuad.frustumCulled = false;
    this.brightScene = new THREE.Scene();
    this.brightScene.add(this.brightQuad);

    this._blurTargets = [];
    this.setSize(1, 1);
  }

  setPixelRatio(_pr) { /* ASCII resolution is independent of DPR */ }

  setSize(w, h) {
    const cellsX = Math.max(2, Math.floor(w / this.charSize));
    const cellsY = Math.max(2, Math.floor(h / this.charSize));
    // Render internal buffer at `resMult`x the character grid so small bright
    // features (enemy markers, tracers, muzzle flashes) survive the downsample.
    const rw = Math.floor(cellsX * this.resMult);
    const rh = Math.floor(cellsY * this.resMult);
    this.rt.setSize(rw, rh);
    this.brightRT.setSize(rw, rh);
    this.material.uniforms.uResolution.value.set(rw, rh);
    // Cell size expressed in *render-target* pixels (== 2).
    this.cellPx = rw / cellsX;
    this.material.uniforms.uCharSize.value = this.cellPx;
  }

  render(scene, camera, time) {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const u = this.material.uniforms;
    u.uTime.value = time || 0;
    u.uCharSize.value = this.cellPx || 2;

    // 1. scene -> rt
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // 2. bright pass
    this.brightMat.uniforms.tScene.value = this.rt.texture;
    this.renderer.setRenderTarget(this.brightRT);
    this.renderer.clear();
    this.renderer.render(this.brightScene, this.quadCam);

    // 3. compose to screen
    this.material.uniforms.tScene.value = this.rt.texture;
    this.material.uniforms.tBright.value = this.brightRT.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  setHit(v) { this.material.uniforms.uHit.value = v; }
}

/**
 * Build a monochrome glyph atlas on a 2D canvas. One glyph per cell.
 * The red channel carries the mask so the shader can index with .r.
 */
export function makeFontAtlas(ramp, cell = 32) {
  const cols = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(ramp.length))));
  // widen to keep power-of-two-ish, but arbitrary is fine for a CanvasTexture
  const rows = Math.ceil(ramp.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.floor(cell * 0.9)}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < ramp.length; i++) {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    ctx.fillText(ramp[i], cx, cy + cell * 0.03);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData = { cols, rows };
  return tex;
}
