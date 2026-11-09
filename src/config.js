// 調整用の数値はすべてここに集める（試作しながら調整する）

export const WORLD = {
  cityDistance: 6200,       // 怪獣の出現地点から街（海岸線）までの距離 (m)。歩いて約10分
  kaijuWaterDepth: 30,      // 怪獣の足元の水深 (m)。すねまで海に沈む
  arenaRadius: 7000,        // 行動可能範囲（怪獣中心）
  gravity: 9.81,
};

export const DIFFICULTY = {
  easy: { label: 'かんたん', hp: 0.6, telegraph: 1.35, cpuSkill: 0.85, cpuReaction: 0.30, attackRate: 0.8 },
  normal: { label: 'ふつう', hp: 1.0, telegraph: 1.0, cpuSkill: 0.65, cpuReaction: 0.45, attackRate: 1.0 },
  hard: { label: 'むずかしい', hp: 1.5, telegraph: 0.78, cpuSkill: 0.5, cpuReaction: 0.62, attackRate: 1.2 },
};

export const MODES = {
  real: { label: 'リアル', respawn: false },
  practice: { label: '練習', respawn: true },
};

export const KAIJU = {
  scale: 2.0,               // モデルの大きさ（全高 約190m）
  baseHp: 7200,             // ひとり・ふつうの時の合計HP
  hpPerAlly: 0.6,           // CPU 1機ごとに増えるHPの割合
  hpPerHuman: 0.9,          // マルチプレイ: 人が1人増えるごとに増えるHPの割合
  headShare: { R: 0.3, C: 0.4, L: 0.3 },
  walkSpeed: 9.6,           // m/s（歩行アニメ 5秒で48m）
  rageWalkSpeed: 11.5,
  flinchPoints: 150,        // 溜め中にこの「怯み値」がたまると怯む（主砲2発・ミサイル1発・魚雷1本・機関砲の連射）
  stunTime: 2.4,
  recoverTime: { R: 1.6, C: 2.2, L: 1.8 },
  vulnerableMul: 1.5,       // 怯み・硬直中の被ダメージ倍率
  bodyDamageMul: 0.85,      // 胴体・脚に当たったときの倍率（生きている頭に分配）
  meleeRange: 560,          // ひれ・しっぽの射程
  beamRange: 3600,
};

// 各攻撃の基本タイミング（秒）。難易度の telegraph 倍率が予告時間に掛かる（最短1秒）
// radius は当たり判定（見た目のビーム・水柱はもっと太い）。船の速さは変わらないので、怪獣が大きくなっても判定は据え置き
export const ATTACKS = {
  bolts: { telegraph: 1.25, count: 7, interval: 0.2, speed: 900, radius: 5, cooldown: [6.0, 9.0] },
  sweep: { telegraph: 1.6, duration: 1.4, radius: 13, length: 1300, cooldown: [10.0, 14.0] },
  trace: { telegraph: 1.5, duration: 1.3, radius: 14, columnRadius: 20, columnHeight: 220, cooldown: [8.0, 11.0] },
  tail: { telegraph: 1.05, duration: 0.55, inner: 80, outer: 580, arc: 230, cooldown: 7.0 },
  claw: { telegraph: 1.0, duration: 0.4, inner: 50, outer: 380, arc: 130, cooldown: 6.0 },
  converge: { telegraph: 2.6, duration: 1.0, radius: 115, cooldown: 24.0 },
  // HPが2割を切ると撃つ「極太ビーム」: 10秒溜めて前方の扇形を薙ぎ払う。溜め中に stopRatio×最大HP のダメージを与えると止まる
  mega: { hpRatio: 0.2, telegraph: 10, duration: 2.6, arc: 100, range: 3500, radius: 60, altMax: 320, stopRatio: 0.05, stopMin: 320, cooldown: 45, exhaust: 6, stun: 7, vuln: 1.2 },
};

// 機関砲（乱射できる武器）: 押している間撃ち続ける。撃ち続けると熱がたまり、過熱すると少し撃てない
const MG_SHIP = { rate: 16, speed: 1000, damage: 1.5, flinch: 3.2, range: 2600, spread: 0.010, heatPerShot: 0.012, coolRate: 0.35, overheatTime: 2.5 };

export const SHIP = {
  maxSpeed: 20,             // m/s（ゲーム用に実艦より機敏）
  speeds: [-0.35, 0, 0.5, 0.75, 1.0],
  speedNames: ['後進', '停止', '半速', '強速', '全速'],
  accel: 3.0,
  turnRate: 7.0,            // 度/秒（全速・舵いっぱい）
  rudderShift: 1.1,         // 舵がいっぱいになるまでの秒数
  length: 160, beam: 20,
  hitRadius: 9,
  gun: { speed: 640, reload: 1.8, damage: 70, flinch: 1.4, maxRange: 7000, spread: 0.0045 },
  mg: MG_SHIP,
  // 魚雷は1隻3本まで（空母の近くで補給しても3本まで）。1本ずつ発射。当たれば強力
  torpedo: { speed: 55, range: 3400, damage: 520, flinch: 3.0, count: 3, salvo: 1, reload: 4 },
};

export const FIGHTER = {
  minSpeed: 85, cruise: 150, maxSpeed: 235,
  accel: 45,
  pitchRate: 62, rollRate: 170, yawRate: 14,  // 度/秒
  hitRadius: 6.5,
  minAlt: 6, maxAlt: 2600,
  gun: { rate: 24, speed: 1100, damage: 3.0, flinch: 2.4, range: 1700, spread: 0.008, heatPerShot: 0.008, coolRate: 0.45, overheatTime: 2.0 },
  missile: { count: 8, speed: 420, turn: 70, damage: 150, flinch: 4.0, lockCone: 26, lockRange: 5600, reload: 1.2 },
  bomb: { gauge: 26, damage: 760, flinch: 3.0, blast: 34 },
};

export const PROP_FIGHTER = {
  minSpeed: 60, cruise: 110, maxSpeed: 165,
  accel: 30,
  pitchRate: 75, rollRate: 200, yawRate: 18,
  hitRadius: 5.5,
  minAlt: 6, maxAlt: 2200,
  gun: { rate: 20, speed: 900, damage: 3.2, flinch: 2.4, range: 1300, spread: 0.011, heatPerShot: 0.0085, coolRate: 0.45, overheatTime: 2.0 },
  rocket: { count: 10, speed: 360, damage: 95, flinch: 3.0, reload: 0.6 },
  bomb: { gauge: 22, damage: 620, flinch: 2.5, blast: 30 },
};

export const CARRIER = {
  speed: 15,                // 怒った怪獣（12.5m/s）より速く下がれるように
  standOff: 3400,           // 怪獣からの距離を保つ（ビームの射程ぎりぎり外）
  resupplyRadius: 480,
  hitRadius: 14,
  hits: 3,                  // 空母だけは3発まで耐える（炎上→轟沈）
};

export const CPU = {
  max: 12,
  damageMul: 0.6,           // CPUの与えるダメージ倍率（主役はプレイヤー）
  callsignsFighter: ['イーグル2', 'イーグル3', 'イーグル4', 'イーグル5', 'ファルコン1', 'ファルコン2', 'ファルコン3', 'ファルコン4', 'ホーク1', 'ホーク2', 'ホーク3', 'ホーク4'],
  shipNames: ['はやせ', 'みなづき', 'あまぎり', 'ゆうなみ', 'しおかぜ', 'あさぎり', 'くもかぜ', 'たちかぜ', 'うみぎり', 'はるかぜ', 'みねぐも', 'ゆきなみ'],
};
