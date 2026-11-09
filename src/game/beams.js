// 怪獣のビームの見た目（カメラを向く帯＋外側の光＋先端の閃光）
import * as THREE from 'three';

const vert = /* glsl */`
attribute float aSide;    // -1 / +1
attribute float aAlong;   // 0 (口) → 1 (先端)
uniform vec3 uA, uB;
uniform float uWidthA, uWidthB;
uniform vec3 uCam;
varying float vSide;
varying float vAlong;
void main(){
  vec3 p = mix(uA, uB, aAlong);
  vec3 dir = normalize(uB - uA);
  vec3 toCam = normalize(uCam - p);
  vec3 side = normalize(cross(dir, toCam));
  float w = mix(uWidthA, uWidthB, aAlong);
  p += side * aSide * w;
  vSide = aSide;
  vAlong = aAlong;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uLength;
uniform float uCore;
varying float vSide;
varying float vAlong;
float hash(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float x = clamp(abs(vSide), 0.0, 1.0);
  // 注意: smoothstep の edge0 > edge1 は未定義（ANGLE/D3D では 0 になる）ので 1-smoothstep で書く
  float core = uCore > 0.0 ? 1.0 - smoothstep(0.0, uCore, x) : 0.0;
  float glow = pow(max(1.0 - x, 0.0), 2.2);
  float s = vAlong * uLength;
  float ripple = 0.75 + 0.25 * sin(s * 0.08 - uTime * 60.0) + 0.15 * sin(s * 0.023 + uTime * 23.0);
  float flick = 0.85 + 0.15 * hash(floor(uTime * 40.0));
  vec3 c = uColor * glow * 2.6 * ripple + mix(uColor, vec3(1.0, 0.97, 0.95), 0.6) * core * 3.2;
  float endFade = smoothstep(0.0, 0.02, vAlong) * (1.0 - smoothstep(0.985, 1.0, vAlong));
  gl_FragColor = vec4(c * uIntensity * flick * endFade, 1.0);
}`;

export class Beam {
  constructor(scene, color, width = 10) {
    const segs = 32;
    const pos = [], side = [], along = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      for (const s of [-1, 1]) { pos.push(0, 0, 0); side.push(s); along.push(i / segs); }
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setIndex(idx);
    this.uniforms = {
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
      uWidthA: { value: width * 0.7 }, uWidthB: { value: width },
      uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 }, uTime: { value: 0 }, uLength: { value: 1 }, uCore: { value: 0.22 },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.visible = false;
    // 外側の大きな光（太さ×3、弱い）
    this.outer = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uWidthA: { value: width * 2.2 }, uWidthB: { value: width * 3.2 }, uIntensity: { value: 0 }, uCore: { value: 0.0 } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.outer.frustumCulled = false;
    this.outer.renderOrder = 24;
    this.outer.visible = false;
    scene.add(this.mesh, this.outer);
    this.scene = scene;
    this.width = width;
  }

  set(a, b, camPos, intensity, time) {
    const u = this.uniforms;
    u.uA.value.copy(a);
    u.uB.value.copy(b);
    u.uCam.value.copy(camPos);
    u.uIntensity.value = intensity;
    u.uTime.value = time;
    u.uLength.value = a.distanceTo(b);
    const ou = this.outer.material.uniforms;
    ou.uIntensity.value = intensity * 0.22;
    this.mesh.visible = this.outer.visible = intensity > 0.001;
  }

  hide() { this.mesh.visible = this.outer.visible = false; }

  dispose() {
    this.scene.remove(this.mesh, this.outer);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.outer.material.dispose();
  }
}

/** 照準線（細い光の線）。蒼の首の予告などに使う */
export class AimLine {
  constructor(scene, color) {
    this.beam = new Beam(scene, color, 1.2);
    this.beam.uniforms.uCore.value = 0.5;
  }
  set(a, b, camPos, intensity, time) { this.beam.set(a, b, camPos, intensity, time); }
  hide() { this.beam.hide(); }
  dispose() { this.beam.dispose(); }
}
