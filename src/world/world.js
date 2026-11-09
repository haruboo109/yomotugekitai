// 世界（描画パイプライン・空・海・太陽・泡・予告・演出・街）をまとめる
import * as THREE from 'three';
import { RenderPipeline, QUALITY_LEVELS } from '../core/renderer.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { FoamSystem } from './foam.js';
import { Effects } from './effects.js';
import { City } from './city.js';
import { TelegraphSystem } from '../game/telegraph.js';
import { makeWaterNormalTexture, makeNoiseTexture, makeParticleAtlas } from './proceduralTextures.js';
import { WORLD } from '../config.js';

export class World {
  constructor(canvas, { sky = 'day', quality = 'high' } = {}) {
    this.pipe = new RenderPipeline(canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 40000);
    this.pipe.init(this.scene, this.camera, quality);
    this.renderer = this.pipe.renderer;
    this.noise = makeNoiseTexture(256, 11);
    this.atlas = makeParticleAtlas(1024);
    this.normalA = makeWaterNormalTexture(256, 7, [1, 0.3]);
    this.normalB = makeWaterNormalTexture(256, 21, [0.4, 1]);
    this.sky = new Sky(this.renderer, this.noise, sky);
    this.preset = this.sky.preset;
    this.scene.background = this.sky.background;
    this.scene.environment = this.sky.environment;
    this.fogColor = this.sky.horizonColor.clone();
    this.scene.fog = new THREE.FogExp2(this.fogColor, this.preset.fogDensity);
    this.sunColor = new THREE.Color(...this.preset.sunColor);
    this.sun = new THREE.DirectionalLight(this.sunColor, this.preset.sunIntensity);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 5200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun, this.sun.target);
    this.shadowFocus = new THREE.Vector3();
    this.shadowExtent = 420;

    const q = QUALITY_LEVELS[quality] || QUALITY_LEVELS.high;
    this.ocean = new Ocean({
      envCube: this.sky.background, sunDir: this.sky.sunDir, sunColor: this.sunColor, sunIntensity: this.preset.sunIntensity,
      normalA: this.normalA, normalB: this.normalB, noise: this.noise, preset: this.preset, quality: q.ocean,
    });
    this.scene.add(this.ocean.mesh);
    this.foam = new FoamSystem(this.renderer, q.foam, 2600);
    this.ocean.setFoam(this.foam.texture, this.foam.rect);
    this.telegraph = new TelegraphSystem(this.renderer, this.scene, 1024, 7200);
    this.ocean.setWarn(this.telegraph.texture, this.telegraph.rect);
    this.effects = new Effects(this.scene, this.atlas, this.fogColor, this.preset.fogDensity, q.particles);
    this.effects.foam = this.foam;
    this.effects.setLighting(this.sunColor, this.preset.ambient);
    this.city = new City(this.scene, WORLD.cityDistance, this.preset);
    this.warnCenter = new THREE.Vector3();
    this.applyShadowQuality(q);
    this.time = 0;
    // 夜は少し明るい月光で海を見やすく
    if (this.preset.stars) this.ocean.uniforms.uEnvIntensity.value = 2.2;
    this.pipe.post.uExposure.value = 0.92 * (this.preset.exposure || 1);
  }

  applyShadowQuality(q) {
    const size = q.shadows;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  setSky(name) {
    this.sky.apply(name);
    const p = this.sky.preset;
    this.preset = p;
    this.scene.environment = this.sky.environment;
    this.fogColor.copy(this.sky.horizonColor);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = p.fogDensity;
    this.sunColor.setRGB(...p.sunColor);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.ocean.applyPreset(p);
    this.ocean.uniforms.uSunIntensity.value = p.sunIntensity;
    this.ocean.uniforms.uEnvIntensity.value = p.stars ? 2.2 : 1.0;
    this.effects.setLighting(this.sunColor, p.ambient);
    this.effects.alpha.material.uniforms.uFogDensity.value = p.fogDensity;
    this.effects.add.material.uniforms.uFogDensity.value = p.fogDensity;
    this.city.setNight(p.label === '昼' ? 0 : p.label === '夜' ? 1 : 0.55);
    this.pipe.post.uExposure.value = 0.92 * (p.exposure || 1);
  }

  setQuality(name) {
    this.pipe.setQuality(name);
    const q = this.pipe.quality;
    this.effects.setQuality(q.particles);
    this.applyShadowQuality(q);
  }

  update(dt) {
    this.time += dt;
    const cam = this.camera;
    this.ocean.update(dt, cam);
    this.foam.update(dt, cam.position.x, cam.position.z);
    this.telegraph.update(dt, this.warnCenter.x, this.warnCenter.z);
    this.effects.update(dt, cam);
    this.city.update(dt);
    // 影の範囲を注目点（怪獣）に追従させる
    const e = this.shadowExtent;
    const sc = this.sun.shadow.camera;
    if (sc.right !== e) { sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.updateProjectionMatrix(); }
    const texel = (2 * e) / (this.sun.shadow.mapSize.x || 1024);
    const f = this.shadowFocus;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sky.sunDir, 2400);
  }

  render(dt) { this.pipe.render(dt); }
  resize() { this.pipe.resize(); }
}
