// 守るべき街（海岸線の向こうのスカイライン）
import * as THREE from 'three';
import { mulberry32 } from './proceduralTextures.js';

export class City {
  constructor(scene, coastZ, preset) {
    this.group = new THREE.Group();
    this.group.name = 'City';
    this.coastZ = coastZ;
    const rand = mulberry32(2026);
    const night = preset.label !== '昼' ? (preset.label === '夜' ? 1 : 0.55) : 0;
    // 陸地
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(16000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.95 }),
    );
    land.position.set(0, 2.2, coastZ + 3000);
    land.receiveShadow = false;
    this.group.add(land);
    // 護岸
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16000, 8, 12), new THREE.MeshStandardMaterial({ color: 0x6d6f6c, roughness: 0.9 }));
    wall.position.set(0, -1.5, coastZ + 4);
    this.group.add(wall);

    // ビル群（インスタンス）
    const count = 900;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.75, metalness: 0.1 });
    this.nightU = { value: night };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.nightU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vObjN; attribute float aSeed;\nvarying float vSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normal; vSeed = aSeed;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vObjN; varying float vSeed; uniform float uNight;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float side = 1.0 - abs(vObjN.y);
          vec2 wp = vec2(abs(vObjN.x) > 0.5 ? vWPos.z : vWPos.x, vWPos.y);
          vec2 cell = floor(wp / vec2(3.2, 3.6));
          vec2 f = fract(wp / vec2(3.2, 3.6));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8) * side;
          diffuseColor.rgb *= mix(1.0, 0.45 + 0.25 * vSeed, win);
          diffuseColor.rgb *= 0.75 + 0.5 * vSeed;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float lit = step(0.62 - uNight * 0.25, h21(cell + vSeed * 13.0));
          totalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * win * lit * uNight * 2.2;`);
    };
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const seeds = new Float32Array(count);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * 7000;
      const depth = 120 + Math.pow(rand(), 0.8) * 2200;
      const z = coastZ + depth;
      const center = Math.exp(-(x * x) / (2 * 1500 * 1500));
      let h = 15 + rand() * 50 + center * rand() * 140;
      if (rand() < 0.05 * center) h = 180 + rand() * 140;
      const w = 18 + rand() * 40, d = 18 + rand() * 40;
      m4.compose(new THREE.Vector3(x, 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.3), new THREE.Vector3(w, h, d));
      inst.setMatrixAt(k, m4);
      seeds[k] = rand();
      k++;
    }
    inst.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    inst.castShadow = false;
    inst.receiveShadow = false;
    this.group.add(inst);

    // 電波塔（街のランドマーク）
    const tower = new THREE.Group();
    const tm = new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.5, metalness: 0.3, emissive: 0xff2010, emissiveIntensity: 0 });
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(3, 26, 240, 4, 1, true), tm);
    legs.position.y = 120;
    tower.add(legs);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 90, 6), tm);
    top.position.y = 285;
    tower.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.5, 0.3) }));
    beacon.position.y = 332;
    tower.add(beacon);
    this.beacon = beacon;
    tower.position.set(-420, 2, coastZ + 900);
    this.group.add(tower);

    // 港のクレーン
    const cm = new THREE.MeshStandardMaterial({ color: 0xb03a26, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 60, 3), cm);
      leg.position.set(0, 30, 0);
      const leg2 = leg.clone(); leg2.position.set(0, 30, 24);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 90), cm);
      boom.position.set(0, 62, -20);
      c.add(leg, leg2, boom);
      c.position.set(900 + i * 70, 2, coastZ + 30);
      this.group.add(c);
    }
    // 灯台
    const lh = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 34, 10), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
    lh.position.set(-1800, 18, coastZ - 20);
    this.group.add(lh);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3) }));
    lamp.position.set(-1800, 37, coastZ - 20);
    this.group.add(lamp);
    this.lamp = lamp;
    scene.add(this.group);
    this.t = 0;
  }

  setNight(v) { this.nightU.value = v; }

  update(dt) {
    this.t += dt;
    this.beacon.visible = Math.sin(this.t * 3) > 0;
    this.lamp.visible = Math.sin(this.t * 1.3) > -0.3;
  }
}
