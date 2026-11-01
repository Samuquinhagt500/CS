import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Player } from './player.js';
import { BotManager } from './bot.js';

/* =========================================================
   Constantes globais
   ========================================================= */

const FIXED_DT = 1 / 128;
const MATCH_DURATION = 10 * 60;
const KILL_TARGET = 25;
const MAP_MIN_X = -30;
const MAP_MAX_X = 30;
const MAP_MIN_Z = -22;
const MAP_MAX_Z = 22;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/* =========================================================
   Áudio procedural — nenhum arquivo externo é necessário
   ========================================================= */

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.volume = 0.32;
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.18;

      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);

      // Buffer de ruído branco usado como base para tiros/passos.
      const length = Math.floor(this.ctx.sampleRate * 1.2);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  output(pan = 0) {
    if (!this.ctx) return null;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      panner.connect(this.master);
      return panner;
    }
    return this.master;
  }

  noiseBurst({
    duration = 0.1,
    filter = 'bandpass',
    frequency = 1200,
    q = 0.8,
    gain = 0.25,
    pan = 0,
    delay = 0,
    attack = 0.002,
  } = {}) {
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filterNode = this.ctx.createBiquadFilter();
    filterNode.type = filter;
    filterNode.frequency.setValueAtTime(frequency, now);
    filterNode.Q.value = q;

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const out = this.output(pan);
    source.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(out);
    source.start(now);
    source.stop(now + duration + 0.03);
  }

  tone({
    frequency = 220,
    endFrequency = 80,
    duration = 0.1,
    type = 'sine',
    gain = 0.1,
    pan = 0,
    delay = 0,
  } = {}) {
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const out = this.output(pan);

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gainNode.gain.setValueAtTime(Math.max(0.0001, gain), now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gainNode);
    gainNode.connect(out);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playGunshot(kind, pan = 0, volume = 1) {
    this.init();
    if (!this.ctx) return;

    if (kind === 'ak47') {
      this.noiseBurst({
        duration: 0.17,
        filter: 'bandpass',
        frequency: 980,
        q: 0.55,
        gain: 0.52 * volume,
        pan,
      });
      this.noiseBurst({
        duration: 0.06,
        filter: 'highpass',
        frequency: 2600,
        q: 0.7,
        gain: 0.25 * volume,
        pan,
      });
      this.tone({
        frequency: 106,
        endFrequency: 43,
        duration: 0.105,
        type: 'triangle',
        gain: 0.34 * volume,
        pan,
      });
    } else {
      this.noiseBurst({
        duration: 0.09,
        filter: 'highpass',
        frequency: 1250,
        q: 0.9,
        gain: 0.3 * volume,
        pan,
      });
      this.tone({
        frequency: 178,
        endFrequency: 62,
        duration: 0.065,
        type: 'square',
        gain: 0.13 * volume,
        pan,
      });
    }
  }

  playPlayerShot(kind) {
    this.playGunshot(kind, 0, kind === 'ak47' ? 0.9 : 0.75);
  }

  playBotShot(position, camera) {
    if (!this.ctx) return;

    const relativeX = position.x - camera.position.x;
    const relativeZ = position.z - camera.position.z;
    const distance = Math.hypot(relativeX, relativeZ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pan = clamp((relativeX * right.x + relativeZ * right.z) / Math.max(distance, 1), -1, 1) * 0.85;
    const volume = clamp(1 / (1 + distance * 0.085), 0.12, 1) * 0.68;

    this.playGunshot('ak47', pan, volume);
  }

  playFootstep(intensity = 0.4) {
    if (!this.ctx) return;

    this.noiseBurst({
      duration: 0.065,
      filter: 'lowpass',
      frequency: 520 + Math.random() * 280,
      q: 0.6,
      gain: 0.12 * intensity + 0.012,
      pan: (Math.random() - 0.5) * 0.28,
    });
  }

  playJump() {
    this.noiseBurst({
      duration: 0.09,
      filter: 'lowpass',
      frequency: 380,
      gain: 0.04,
    });
  }

  playReload(kind) {
    const speed = kind === 'ak47' ? 0 : 0.08;
    this.noiseBurst({ duration: 0.035, filter: 'highpass', frequency: 1800, gain: 0.11, delay: 0.05 + speed });
    this.noiseBurst({ duration: 0.045, filter: 'bandpass', frequency: 900, gain: 0.13, delay: 0.42 });
    this.noiseBurst({ duration: 0.04, filter: 'highpass', frequency: 2200, gain: 0.12, delay: 1.35 + speed });
  }

  playSwitch() {
    this.noiseBurst({ duration: 0.04, filter: 'highpass', frequency: 1500, gain: 0.08, delay: 0.03 });
  }

  playEmpty() {
    this.tone({ frequency: 1300, endFrequency: 750, duration: 0.025, type: 'square', gain: 0.06 });
    this.noiseBurst({ duration: 0.025, filter: 'highpass', frequency: 2600, gain: 0.08 });
  }

  playHit(headshot = false) {
    if (headshot) {
      this.tone({ frequency: 1280, endFrequency: 1120, duration: 0.07, type: 'sine', gain: 0.09 });
      this.tone({ frequency: 1850, endFrequency: 1600, duration: 0.11, type: 'sine', gain: 0.07, delay: 0.035 });
    } else {
      this.tone({ frequency: 660, endFrequency: 510, duration: 0.045, type: 'triangle', gain: 0.055 });
    }
  }

  playKill() {
    this.tone({ frequency: 520, endFrequency: 760, duration: 0.12, type: 'triangle', gain: 0.06 });
    this.noiseBurst({ duration: 0.08, filter: 'lowpass', frequency: 300, gain: 0.12 });
  }

  playPlayerHurt() {
    this.noiseBurst({ duration: 0.16, filter: 'lowpass', frequency: 300, gain: 0.16 });
    this.tone({ frequency: 72, endFrequency: 45, duration: 0.16, type: 'sine', gain: 0.12 });
  }
}

/* =========================================================
   Granada de alto explosivo (HE)
   ========================================================= */

class Grenade {
  constructor({ world, scene, position, velocity, type = 'he', owner, game }) {
    this.world = world;
    this.scene = scene;
    this.game = game;
    this.type = type;
    this.owner = owner;
    this.timer = type === 'he' ? 3.0 : 2.5;
    this.exploded = false;
    this.removed = false;

    const geo = new THREE.SphereGeometry(0.12, 8, 8);
    const mat = type === 'smoke'
      ? new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.6 })
      : type === 'flash'
        ? new THREE.MeshBasicMaterial({ color: 0xffffee })
        : new THREE.MeshStandardMaterial({ color: 0x553300 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);

    this.body = new CANNON.Body({
      mass: 0.4,
      shape: new CANNON.Sphere(0.12),
      linearDamping: 0.1,
      angularDamping: 0.5,
    });
    this.body.position.copy(position);
    this.body.velocity.copy(velocity);
    this.body.angularVelocity.set(Math.random(), Math.random(), Math.random());
    this.world.addBody(this.body);
  }

  update(dt) {
    if (this.exploded || this.removed) return;
    this.timer -= dt;

    this.mesh.position.copy(this.body.position);

    if (this.timer <= 0) {
      this.explode();
    }
  }

  explode() {
    this.exploded = true;
    const pos = this.body.position;

    if (this.type === 'he' && this.game) {
      // Efeito visual da explosão
      this.game.spawnParticles(pos, new THREE.Vector3(0, 1, 0), 0x8f1b14, 20, 4, 0.05, 6, false);
      this.game.spawnDust(pos, new THREE.Vector3(0, 1, 0));

      // Flash de luz branca no centro da explosão
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      flash.position.copy(pos);
      flash.scale.setScalar(2.5);
      this.scene.add(flash);
      if (this.game) {
        this.game.effects.push({
          type: 'sprite',
          sprite: flash,
          life: 0.12,
          maxLife: 0.12,
          baseScale: 2.5,
        });
      }

      // Som de explosão
      if (this.game.audio) {
        this.game.audio.init();
        this.game.audio.noiseBurst({
          duration: 0.6,
          filter: 'lowpass',
          frequency: 120,
          q: 0.5,
          gain: 0.35,
          pan: 0,
        });
        this.game.audio.tone({
          frequency: 60,
          endFrequency: 30,
          duration: 0.5,
          type: 'sawtooth',
          gain: 0.15,
        });
      }
    }

    const radius = 10;

    // Dano ao jogador
    const player = this.owner;
    if (player && player.alive && player.spawnProtection <= 0) {
      const dist = pos.distanceTo(player.body.position);
      if (dist < radius) {
        const dmg = Math.max(0, 40 * (1 - dist / radius));
        player.applyDamage(dmg, 'chest');
      }
    }

    // Dano aos bots
    const botManager = this.game?.botManager;
    if (botManager) {
      for (const bot of botManager.bots) {
        if (!bot.alive) continue;
        const dist = pos.distanceTo(bot.position);
        if (dist < radius) {
          const dmg = Math.max(0, 45 * (1 - dist / radius));
          bot.takeDamage(dmg, 'chest');
        }
      }
    }

    setTimeout(() => {
      this.remove();
    }, 600);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    try {
      this.world.removeBody(this.body);
    } catch { /* already removed */ }
    try {
      this.scene.remove(this.mesh);
    } catch { /* already removed */ }
  }
}

/* =========================================================
   Jogo
   ========================================================= */

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ui = this.cacheUI();
    this.audio = new AudioManager();
    this.clock = new THREE.Clock();
    this.accumulator = 0;

    this.state = 'menu';
    this.kills = 0;
    this.deaths = 0;
    this.matchTime = MATCH_DURATION;
    this.endAfter = 0;
    this.respawnCountdown = 0;
    this.radarTimer = 0;
    this.hudTimer = 0;
    this.hintTimer = null;
    this.reloadHintActive = false;
    this.dustTime = 0;

    this.effects = [];
    this.decals = [];
    this.grenades = [];
    this.bulletHoleMaterial = new THREE.MeshBasicMaterial({
      color: 0x11100d,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    });
    this.bulletHoleGeometry = new THREE.CircleGeometry(0.034, 7);

    this.initRenderer();
    this.initPhysics();
    this.initScene();
    this.buildMap();
    this.createAtmosphere();
    this.createPlayer();
    this.createBots();
    this.bindUI();
    this.bindGameEvents();
    this.resize();

    this.player.setSensitivity(Number(this.ui.sensitivity.value));
    this.updateScoreHud();
    this.updateHealthHud(this.player.health, this.player.armor);
    this.updateAmmoHud({
      weapon: this.player.weapon,
      clip: this.player.ammoState.clip,
      reserve: this.player.ammoState.reserve,
      reloading: false,
    });

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  cacheUI() {
    return {
      hud: document.getElementById('hud'),
      startScreen: document.getElementById('start-screen'),
      pauseScreen: document.getElementById('pause-screen'),
      deathScreen: document.getElementById('death-screen'),
      gameoverScreen: document.getElementById('gameover-screen'),
      startButton: document.getElementById('start-button'),
      resumeButton: document.getElementById('resume-button'),
      restartButton: document.getElementById('restart-button'),
      botCount: document.getElementById('bot-count'),
      sensitivity: document.getElementById('sensitivity'),
      sensitivityOutput: document.getElementById('sensitivity-output'),
      playerKills: document.getElementById('player-kills'),
      playerDeaths: document.getElementById('player-deaths'),
      botsAlive: document.getElementById('bots-alive'),
      roundTimer: document.getElementById('round-timer'),
      health: document.getElementById('health'),
      armor: document.getElementById('armor'),
      ammoClip: document.getElementById('ammo-clip'),
      ammoReserve: document.getElementById('ammo-reserve'),
      weaponName: document.getElementById('weapon-name'),
      reloadHint: document.getElementById('reload-hint'),
      crosshair: document.getElementById('crosshair'),
      hitmarker: document.getElementById('hitmarker'),
      headshotFlash: document.getElementById('headshot-flash'),
      centerHint: document.getElementById('center-hint'),
      damageVignette: document.getElementById('damage-vignette'),
      lowHealthVignette: document.getElementById('low-health-vignette'),
      killFeed: document.getElementById('kill-feed'),
      radar: document.getElementById('radar'),
      radarStatus: document.getElementById('radar-status'),
      deathCredit: document.getElementById('death-credit'),
      respawnCountdown: document.getElementById('respawn-countdown'),
      resultTitle: document.getElementById('result-title'),
      resultKills: document.getElementById('result-kills'),
      resultDeaths: document.getElementById('result-deaths'),
      resultKd: document.getElementById('result-kd'),
      fatalError: document.getElementById('fatal-error'),
    };
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  initPhysics() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -20, 0),
      allowSleep: true,
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 12;
    this.world.solver.tolerance = 0.001;
    this.world.defaultContactMaterial.friction = 0;
    this.world.defaultContactMaterial.restitution = 0;
    this.staticMaterial = new CANNON.Material('static');
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa7bcbf);
    this.scene.fog = new THREE.Fog(0xc8b38c, 38, 108);

    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      0.035,
      220,
    );
    this.scene.add(this.camera);

    // Céu em degradê + brilho solar, sem depender de imagens externas.
    const skyGeometry = new THREE.SphereGeometry(150, 28, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x6d96b5) },
        bottomColor: { value: new THREE.Color(0xd7c6a6) },
        sunColor: { value: new THREE.Color(0xffdaa0) },
        sunDirection: { value: new THREE.Vector3(0.48, 0.54, 0.26).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vWorldPosition;

        void main() {
          vec3 direction = normalize(vWorldPosition);
          float height = max(direction.y, 0.0);
          float blend = pow(height, 0.58);
          vec3 color = mix(bottomColor, topColor, blend);
          float sun = pow(max(dot(direction, normalize(sunDirection)), 0.0), 72.0);
          color += sunColor * sun * 0.42;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    this.scene.add(sky);

    const hemisphere = new THREE.HemisphereLight(0xe5edf0, 0x8a7051, 1.55);
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(0xffe8c5, 0.18);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffe1b3, 2.35);
    sun.position.set(26, 38, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 100;
    sun.shadow.bias = -0.00045;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    this.map = {
      bounds: {
        minX: MAP_MIN_X,
        maxX: MAP_MAX_X,
        minZ: MAP_MIN_Z,
        maxZ: MAP_MAX_Z,
      },
      colliders: [],
      occluders: [],
      playerSpawns: [
        // Locais abrigados: cantos, becos e interiores de corredor.
        // A seleção final prioriza pontos sem linha de visão para os bots.
        { x: 0, z: 20.1, yaw: 0, safe: true },
        { x: -27.6, z: 19.3, yaw: 0.08, safe: true },
        { x: 27.6, z: 19.3, yaw: -0.08, safe: true },
        { x: -20.5, z: 10.7, yaw: 0, safe: true },
        { x: 22.5, z: 10.7, yaw: 0, safe: true },
        { x: -27.6, z: 6.4, yaw: 0, safe: true },
        { x: 27.6, z: 6.4, yaw: 0, safe: true },
        { x: -13, z: 19.9, yaw: 0.05, safe: true },
        { x: 13, z: 19.9, yaw: -0.05, safe: true },
      ],
      botSpawns: [
        { x: -27, z: -18 }, { x: -14, z: -18 }, { x: 0, z: -18 },
        { x: 14, z: -18 }, { x: 27, z: -18 }, { x: -27, z: 3 },
        { x: 27, z: 3 }, { x: -26, z: 17 }, { x: 27.5, z: 17.5 },
        { x: -15, z: 1 }, { x: 15, z: 1 },
      ],
      patrolPoints: [
        { x: -26, z: -17 }, { x: -14, z: -18 }, { x: 0, z: -18 },
        { x: 14, z: -18 }, { x: 26, z: -17 }, { x: -26, z: -3 },
        { x: 26, z: -3 }, { x: -26, z: 15 }, { x: 26, z: 15 },
        { x: -16, z: 15 }, { x: 16, z: 15 }, { x: -5, z: 1 },
        { x: 5, z: 1 }, { x: 0, z: 8 }, { x: 0, z: -6 },
        { x: -20, z: 15 }, { x: 20, z: 15 },
      ],
    };
  }

  /* =======================================================
     Texturas procedurais e mapa
     ======================================================= */

  createCanvasTexture(painter, size = 256, repeat = true) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    painter(ctx, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (repeat) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
    texture.needsUpdate = true;
    return texture;
  }

  createTextures() {
    const sand = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#bca47a';
      ctx.fillRect(0, 0, size, size);

      const palette = ['#c8b088', '#a98f66', '#d2bb94', '#93805e', '#b59d73'];
      for (let i = 0; i < 6200; i += 1) {
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        ctx.globalAlpha = 0.12 + Math.random() * 0.22;
        const radius = Math.random() * 1.7 + 0.3;
        ctx.fillRect(Math.random() * size, Math.random() * size, radius, radius);
      }
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = '#6f5d43';
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i += 1) {
        ctx.beginPath();
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.random() * 46 - 23, y + Math.random() * 46 - 23);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    const stoneFloor = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#aa946f';
      ctx.fillRect(0, 0, size, size);

      const tile = 64;
      for (let y = 0; y < size; y += tile) {
        for (let x = 0; x < size; x += tile) {
          const shade = 150 + Math.floor(Math.random() * 28);
          ctx.fillStyle = `rgb(${shade + 16}, ${shade}, ${shade - 35})`;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(73, 58, 40, 0.4)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= size; i += tile) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
      }
      for (let i = 0; i < 3800; i += 1) {
        ctx.fillStyle = i % 3 === 0 ? '#d0bb93' : '#7f6c50';
        ctx.globalAlpha = 0.07 + Math.random() * 0.15;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    });

    const wall = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#b8956c';
      ctx.fillRect(0, 0, size, size);

      const rowHeight = 32;
      const brickWidth = 62;
      for (let row = 0; row < size / rowHeight; row += 1) {
        const offset = row % 2 === 0 ? 0 : -brickWidth / 2;
        for (let x = offset; x < size; x += brickWidth) {
          const shade = 158 + Math.floor(Math.random() * 34);
          ctx.fillStyle = `rgb(${shade + 26}, ${shade}, ${shade - 36})`;
          ctx.globalAlpha = 0.34 + Math.random() * 0.18;
          ctx.fillRect(x + 2, row * rowHeight + 2, brickWidth - 4, rowHeight - 4);
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(107, 84, 57, 0.55)';
      ctx.lineWidth = 2;
      for (let y = 0; y <= size; y += rowHeight) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      for (let row = 0; row < size / rowHeight; row += 1) {
        const offset = row % 2 === 0 ? 0 : brickWidth / 2;
        for (let x = offset; x <= size; x += brickWidth) {
          ctx.beginPath();
          ctx.moveTo(x, row * rowHeight);
          ctx.lineTo(x, row * rowHeight + rowHeight);
          ctx.stroke();
        }
      }
      for (let i = 0; i < 2200; i += 1) {
        ctx.fillStyle = Math.random() > 0.5 ? '#e0c69a' : '#7a6144';
        ctx.globalAlpha = 0.05 + Math.random() * 0.13;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    });

    const crate = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#8a5a2f';
      ctx.fillRect(0, 0, size, size);

      const plankHeight = size / 5;
      for (let i = 0; i < 5; i += 1) {
        const shade = 110 + Math.floor(Math.random() * 35);
        ctx.fillStyle = `rgb(${shade + 35}, ${shade - 3}, ${Math.max(30, shade - 55)})`;
        ctx.globalAlpha = 0.34;
        ctx.fillRect(2, i * plankHeight + 2, size - 4, plankHeight - 4);
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = 'rgba(54, 31, 15, 0.5)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 5; i += 1) {
        ctx.beginPath();
        ctx.moveTo(0, i * plankHeight);
        ctx.lineTo(size, i * plankHeight);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(39, 29, 20, 0.8)';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, size - 12, size - 12);
      ctx.lineWidth = 5;
      ctx.strokeRect(19, 19, size - 38, size - 38);

      ctx.strokeStyle = 'rgba(35, 32, 27, 0.6)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(18, 18);
      ctx.lineTo(size - 18, size - 18);
      ctx.moveTo(size - 18, 18);
      ctx.lineTo(18, size - 18);
      ctx.stroke();

      ctx.fillStyle = 'rgba(40, 34, 24, 0.35)';
      for (let i = 0; i < 650; i += 1) {
        ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
      }

      ctx.fillStyle = 'rgba(33, 25, 17, 0.32)';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SUPPLY', size / 2, size / 2 - 3);
      ctx.font = '12px monospace';
      ctx.fillText('05 / DUST', size / 2, size / 2 + 16);
    });

    const concrete = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#8b887c';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 5600; i += 1) {
        const light = Math.random() > 0.5;
        ctx.fillStyle = light ? '#a6a397' : '#66645b';
        ctx.globalAlpha = 0.06 + Math.random() * 0.14;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.8, 1.8);
      }
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#4d4b44';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i += 1) {
        let x = Math.random() * size;
        let y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 4; j += 1) {
          x += Math.random() * 18 - 9;
          y += Math.random() * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    const metal = this.createCanvasTexture((ctx, size) => {
      ctx.fillStyle = '#5d5b53';
      ctx.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 16) {
        ctx.fillStyle = x % 32 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
        ctx.fillRect(x, 0, 8, size);
      }
      for (let i = 0; i < 2600; i += 1) {
        ctx.fillStyle = Math.random() > 0.5 ? '#818077' : '#3f3e38';
        ctx.globalAlpha = 0.07 + Math.random() * 0.12;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
      }
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#2c2b27';
      for (let x = 10; x < size; x += 64) {
        for (let y = 10; y < size; y += 64) {
          ctx.beginPath();
          ctx.arc(x, y, 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ab915e';
      ctx.fillRect(0, size * 0.31, size, 5);
      ctx.globalAlpha = 1;
    });

    return { sand, stoneFloor, wall, crate, concrete, metal };
  }

  makeSiteTexture(label, color) {
    return this.createCanvasTexture((ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.font = 'bold 150px Impact, Arial Narrow, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, size / 2, size / 2 + 7);
      ctx.globalAlpha = 1;
    }, 256, false);
  }

  buildMap() {
    this.textures = this.createTextures();

    this.materials = {
      wall: new THREE.MeshStandardMaterial({
        map: this.textures.wall,
        color: 0xd0b58c,
        roughness: 0.95,
        metalness: 0,
      }),
      crate: new THREE.MeshStandardMaterial({
        map: this.textures.crate,
        color: 0xc8a273,
        roughness: 0.9,
        metalness: 0.02,
      }),
      concrete: new THREE.MeshStandardMaterial({
        map: this.textures.concrete,
        color: 0xb7b4a7,
        roughness: 0.98,
      }),
      metal: new THREE.MeshStandardMaterial({
        map: this.textures.metal,
        color: 0x8e8c82,
        roughness: 0.62,
        metalness: 0.5,
      }),
    };

    // Piso.
    const floorMap = this.textures.stoneFloor.clone();
    floorMap.needsUpdate = true;
    floorMap.wrapS = THREE.RepeatWrapping;
    floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.repeat.set(12, 9);
    floorMap.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorMap,
      color: 0xd5c09b,
      roughness: 1,
      metalness: 0,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 44), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.map.occluders.push(floor);

    const floorBody = new CANNON.Body({
      mass: 0,
      material: this.staticMaterial,
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    });
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(30, 0.5, 22)));
    floorBody.position.set(0, -0.5, 0);
    this.world.addBody(floorBody);

    // Muros externos (5 m de altura).
    this.addStaticBox(0, 2.5, -22.5, 60, 5, 1, 'wall');
    this.addStaticBox(0, 2.5, 22.5, 60, 5, 1, 'wall');
    this.addStaticBox(-30, 2.5, 0, 1, 5, 44, 'wall');
    this.addStaticBox(30, 2.5, 0, 1, 5, 44, 'wall');

    // Corredor central / mid.
    this.addStaticBox(-9.8, 1.7, 2, 0.9, 3.4, 14, 'wall');
    this.addStaticBox(9.8, 1.7, 2, 0.9, 3.4, 14, 'wall');

    // "Portas do mid": parede com vão central + lintel.
    this.addStaticBox(-6, 1.65, -10, 5, 3.3, 0.8, 'wall');
    this.addStaticBox(6, 1.65, -10, 5, 3.3, 0.8, 'wall');
    this.addStaticBox(-3.7, 1.65, -10, 0.4, 3.3, 0.8, 'metal');
    this.addStaticBox(3.7, 1.65, -10, 0.4, 3.3, 0.8, 'metal');
    this.addStaticBox(0, 3.43, -10, 8, 0.55, 0.8, 'metal', {
      collide: false,
      occlude: true,
    });

    // Túnel B (oeste).
    this.addStaticBox(-23, 1.5, 6, 0.9, 3, 14, 'wall');
    this.addStaticBox(-18, 1.5, 6, 0.9, 3, 14, 'wall');
    this.addStaticBox(-20.5, 3.18, 6, 5.4, 0.36, 14, 'concrete', {
      collide: false,
      occlude: false,
      castShadow: true,
    });

    // Corredor longo (leste).
    this.addStaticBox(25, 1.5, 3, 0.9, 3, 18, 'wall');
    this.addStaticBox(20, 1.5, 7, 0.9, 3, 10, 'wall');
    this.addStaticBox(22.5, 3.18, 5.5, 4.2, 0.36, 15, 'concrete', {
      collide: false,
      occlude: false,
      castShadow: true,
    });

    // Coberturas baixas no spawn e nas entradas dos sites.
    this.addStaticBox(-4, 0.6, 13, 5, 1.2, 1, 'concrete');
    this.addStaticBox(7, 0.6, 10, 4, 1.2, 1, 'concrete');
    this.addStaticBox(14, 0.6, -12, 6, 1.2, 1, 'concrete');
    this.addStaticBox(-16, 0.6, -12, 6, 1.2, 1, 'concrete');

    // Site A: estrutura de cobertura.
    this.addStaticBox(24, 1.35, -13, 0.8, 2.7, 7, 'wall');
    this.addStaticBox(18.5, 0.72, -20, 5.6, 1.44, 0.8, 'concrete');

    // Site B: mureta e caixas.
    this.addStaticBox(-25, 1.35, -13, 0.8, 2.7, 7, 'wall');
    this.addStaticBox(-18.5, 0.72, -20, 5.6, 1.44, 0.8, 'concrete');

    // Caixas / cobertura.
    this.addCrate(-4, 6, 1.7);
    this.addCrate(5, 4.2, 1.8);
    this.addCrate(-15, 17, 1.6);
    this.addCrate(17, 16, 1.7);
    this.addCrate(-20.6, -7.5, 1.7);
    this.addCrate(20.5, -8, 1.7);
    this.addCrate(0, -4.5, 1.6);
    this.addCrate(-7, -17, 1.6);
    this.addCrate(7, -17, 1.6);
    this.addCrate(17, -17, 1.7);
    this.addCrate(12, 2, 1.55);
    this.addCrate(-25, -17, 1.8);
    this.addCrate(-25, -17, 1.22, 1.8);
    this.addCrate(25, 17, 1.65);

    // Barris.
    this.addBarrel(-14, 0, 10);
    this.addBarrel(23, 0, 16);
    this.addBarrel(-25.5, 0, -12);
    this.addBarrel(10, 0, 18);

    // Marcadores A / B no chão.
    this.addSiteMarker('A', '#d88b34', 18.5, -16, 4.4);
    this.addSiteMarker('B', '#d88b34', -20.5, -16, 4.4);

    this.addMapDetails();
  }

  makeBoxMaterial(type, width, height, depth) {
    const base = this.materials[type] || this.materials.wall;
    const material = base.clone();
    if (base.map) {
      material.map = base.map.clone();
      material.map.needsUpdate = true;
      const repeatScale = type === 'crate' ? 1 : type === 'metal' ? 0.65 : 0.34;
      const horizontal = Math.max(width, depth);
      material.map.repeat.set(
        Math.max(1, Math.round(horizontal * repeatScale)),
        Math.max(1, Math.round(height * repeatScale)),
      );
    }
    return material;
  }

  addStaticBox(x, y, z, width, height, depth, type = 'wall', options = {}) {
    const {
      collide = true,
      occlude = true,
      castShadow = true,
      receiveShadow = true,
    } = options;

    const material = this.makeBoxMaterial(type, width, height, depth);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.scene.add(mesh);

    if (occlude) this.map.occluders.push(mesh);

    if (collide) {
      const body = new CANNON.Body({
        mass: 0,
        material: this.staticMaterial,
        collisionFilterGroup: 1,
        collisionFilterMask: 2,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)));
      body.position.set(x, y, z);
      this.world.addBody(body);

      this.map.colliders.push({
        minX: x - width / 2,
        maxX: x + width / 2,
        minY: y - height / 2,
        maxY: y + height / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      });
    }

    return mesh;
  }

  addCrate(x, z, size = 1.7, baseY = 0) {
    return this.addStaticBox(
      x,
      baseY + size / 2,
      z,
      size,
      size,
      size,
      'crate',
    );
  }

  addBarrel(x, baseY, z) {
    const material = this.materials.metal.clone();
    material.color.setHex(0x7d5a34);
    material.roughness = 0.82;
    material.metalness = 0.35;

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.35, 1.05, 12),
      material,
    );
    barrel.position.set(x, baseY + 0.525, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    this.scene.add(barrel);
    this.map.occluders.push(barrel);

    const body = new CANNON.Body({
      mass: 0,
      material: this.staticMaterial,
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 0.525, 0.35)));
    body.position.set(x, baseY + 0.525, z);
    this.world.addBody(body);

    this.map.colliders.push({
      minX: x - 0.35,
      maxX: x + 0.35,
      minY: baseY,
      maxY: baseY + 1.05,
      minZ: z - 0.35,
      maxZ: z + 0.35,
    });
  }

  addSiteMarker(label, color, x, z, size) {
    const texture = this.makeSiteTexture(label, color);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, 0.016, z);
    marker.renderOrder = 1;
    this.scene.add(marker);
  }

  addMapDetails() {
    const beamMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a3f27,
      roughness: 0.92,
    });

    // Vigas de madeira sobre as entradas dos túneis.
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 5.7), beamMaterial);
      beam.position.set(side * 20.5, 3.02, 3.5);
      beam.castShadow = true;
      this.scene.add(beam);
    }

    // Tapumes decorativos no fundo dos sites.
    this.addStaticBox(-22, 0.8, -20.5, 5.8, 1.6, 0.28, 'metal');
    this.addStaticBox(22, 0.8, -20.5, 5.8, 1.6, 0.28, 'metal');

    // Pequenos blocos de detritos (sem colisão para não travar a navegação).
    const rubbleMaterial = new THREE.MeshStandardMaterial({
      color: 0x85745a,
      roughness: 1,
    });
    for (let i = 0; i < 26; i += 1) {
      const size = 0.08 + Math.random() * 0.17;
      const rubble = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 0.5, size * (0.7 + Math.random() * 0.8)),
        rubbleMaterial,
      );
      rubble.position.set(
        (Math.random() - 0.5) * 54,
        0.03,
        (Math.random() - 0.5) * 38,
      );
      rubble.rotation.y = Math.random() * Math.PI;
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      this.scene.add(rubble);
    }

    // Fios/cabos improvisados para quebrar a leitura das paredes.
    const cableMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2822 });
    for (let i = 0; i < 4; i += 1) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-28 + i * 14, 4.4, -21.95),
        new THREE.Vector3(-26 + i * 14, 4.0, -21.9),
        new THREE.Vector3(-24 + i * 14, 4.35, -21.94),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.025, 4, false), cableMaterial);
      this.scene.add(tube);
    }
  }

  createAtmosphere() {
    const count = 210;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 58;
      positions[i * 3 + 1] = 0.4 + Math.random() * 6.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 42;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xe8d6ae,
      size: 0.038,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geometry, material);
    this.scene.add(this.dust);
  }

  createPlayer() {
    this.player = new Player({
      camera: this.camera,
      domElement: this.canvas,
      world: this.world,
      scene: this.scene,
      audio: this.audio,
      spawn: this.map.playerSpawns[0],
      callbacks: {
        onFire: (shot) => this.handlePlayerShot(shot),
        onHealthChanged: (health, armor) => this.updateHealthHud(health, armor),
        onAmmoChanged: (data) => this.updateAmmoHud(data),
        onWeaponChanged: (weapon) => {
          this.ui.weaponName.textContent = weapon.name;
        },
        onDamage: (info) => this.handlePlayerDamage(info),
        onDeath: (info) => this.handlePlayerDeath(info),
        onReloadState: (reloading) => this.handleReloadState(reloading),
        onEmpty: () => {
          if (this.state === 'playing' && this.player.ammoState.reserve > 0) {
            this.showHint('PENTE VAZIO — PRESSIONE R', 1400);
          }
        },
        onRespawn: () => this.clearDamageEffects(),
        onGrenadeThrown: (data) => this.spawnGrenade(data),
      },
    });
  }

  createBots() {
    this.botManager = new BotManager({
      scene: this.scene,
      player: this.player,
      world: this.world,
      map: this.map,
      callbacks: {
        onBotShot: (shot) => this.handleBotShot(shot),
      },
    });
    this.botManager.setCount(0);
  }

  /* =======================================================
     Interface / fluxo de partida
     ======================================================= */

  bindUI() {
    let savedSensitivity = 1;
    let savedBots = '5';
    try {
      savedSensitivity = Number(localStorage.getItem('tsweb_sensitivity') || '1');
      savedBots = localStorage.getItem('tsweb_bots') || '5';
    } catch {
      // localStorage pode estar bloqueado em alguns navegadores.
    }

    this.ui.sensitivity.value = String(clamp(savedSensitivity, 0.25, 2.5));
    this.ui.sensitivityOutput.textContent = Number(this.ui.sensitivity.value).toFixed(2);
    if ([...this.ui.botCount.options].some((option) => option.value === savedBots)) {
      this.ui.botCount.value = savedBots;
    }

    this.ui.sensitivity.addEventListener('input', () => {
      const value = Number(this.ui.sensitivity.value);
      this.ui.sensitivityOutput.textContent = value.toFixed(2);
      this.player.setSensitivity(value);
      try {
        localStorage.setItem('tsweb_sensitivity', String(value));
      } catch {
        // Sem persistência: o slider continua funcionando nesta sessão.
      }
    });

    this.ui.botCount.addEventListener('change', () => {
      try {
        localStorage.setItem('tsweb_bots', this.ui.botCount.value);
      } catch {
        // Ignora ambientes com storage desativado.
      }
    });

    this.ui.startButton.addEventListener('click', () => this.startMatch());
    this.ui.resumeButton.addEventListener('click', () => {
      this.audio.init();
      this.player.lock();
    });
    this.ui.restartButton.addEventListener('click', () => this.startMatch());
  }

  bindGameEvents() {
    this.player.controls.addEventListener('lock', () => {
      if (this.state === 'paused') {
        this.state = 'playing';
        this.ui.pauseScreen.classList.add('hidden');
        this.accumulator = 0;
        this.clock.getDelta();
      }
    });

    this.player.controls.addEventListener('unlock', () => {
      this.player.clearInput();
      if (this.state === 'playing') {
        this.state = 'paused';
        this.ui.pauseScreen.classList.remove('hidden');
      }
    });

    document.addEventListener('pointerlockerror', () => {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.state = 'menu';
      this.ui.pauseScreen.classList.add('hidden');
      this.ui.hud.classList.remove('is-visible');
      this.ui.startScreen.classList.remove('hidden');
      this.showFatal('O navegador bloqueou o Pointer Lock. Clique novamente em ENTRAR NO SERVIDOR.');
    });

    window.addEventListener('resize', () => this.resize());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyM' && (this.state === 'playing' || this.state === 'paused')) {
        const muted = this.audio.toggleMute();
        if (this.state === 'playing') {
          this.showHint(muted ? 'SOM MUDO' : 'SOM ATIVADO', 900);
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') {
        this.player.unlock();
      }
    });
  }

  startMatch() {
    if (this.state === 'playing' || this.state === 'paused') return;

    this.audio.init();
    this.newMatch();
    this.ui.startScreen.classList.add('hidden');
    this.ui.gameoverScreen.classList.add('hidden');
    this.ui.pauseScreen.classList.add('hidden');
    this.ui.deathScreen.classList.add('hidden');
    this.ui.hud.classList.add('is-visible');
    this.state = 'playing';
    this.accumulator = 0;
    this.clock.getDelta();
    this.player.lock();
  }

  newMatch() {
    this.kills = 0;
    this.deaths = 0;
    this.matchTime = MATCH_DURATION;
    this.endAfter = 0;
    this.respawnCountdown = 0;
    this.reloadHintActive = false;
    this.clearEffects();
    this.clearHint();
    this.ui.killFeed.replaceChildren();
    this.ui.deathScreen.classList.add('hidden');
    this.ui.damageVignette.classList.remove('hit');
    this.ui.lowHealthVignette.classList.remove('active');
    this.ui.hitmarker.classList.remove('show');
    this.ui.headshotFlash.classList.remove('show');

    const count = Number(this.ui.botCount.value) || 5;
    this.botManager.setCount(count);

    const spawn = this.pickPlayerSpawn();
    this.player.respawn(spawn);
    this.botManager.reset();

    this.ui.roundTimer.textContent = formatTime(this.matchTime);
    this.updateScoreHud();
    this.updateHealthHud(this.player.health, this.player.armor);
    this.updateAmmoHud({
      weapon: this.player.weapon,
      clip: this.player.ammoState.clip,
      reserve: this.player.ammoState.reserve,
      reloading: false,
    });
    this.drawRadar();
  }

  pickPlayerSpawn() {
    const candidates = this.map.playerSpawns;
    let best = candidates[0];
    let bestScore = -Infinity;

    const samples = 40;
    for (let i = 0; i < samples; i += 1) {
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];
      const spawnEye = new THREE.Vector3(candidate.x, 1.15, candidate.z);

      let nearestBot = 60;
      let exposedTo = 0;

      for (const bot of this.botManager.bots) {
        if (!bot.alive) continue;

        const distance = Math.hypot(
          candidate.x - bot.position.x,
          candidate.z - bot.position.z,
        );
        nearestBot = Math.min(nearestBot, distance);

        const botEye = new THREE.Vector3(bot.position.x, 1.25, bot.position.z);
        if (this.botManager.hasLineOfSight(spawnEye, botEye)) {
          exposedTo += 1;
        }
      }

      // Nunca renasce em um ponto com linha de visão direta para um bot vivo.
      if (exposedTo > 0) continue;

      // Prioriza locais escondidos e longe dos bots.
      let score = Math.min(nearestBot, 40)
        + (candidate.safe ? 14 : 0)
        + Math.random() * 2.5;

      if (nearestBot < 7) {
        score -= (7 - nearestBot) * 14;
      }

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return {
      x: best.x,
      z: best.z,
      yaw: (best.yaw ?? 0) + (Math.random() - 0.5) * 0.18,
    };
  }

  endMatch(reason = 'time') {
    if (this.state === 'over') return;

    this.state = 'over';
    this.player.clearInput();
    this.player.unlock();
    this.ui.pauseScreen.classList.add('hidden');
    this.ui.deathScreen.classList.add('hidden');

    this.ui.resultTitle.textContent = reason === 'kills'
      ? 'ALVO ELIMINADO'
      : 'TEMPO ESGOTADO';
    this.ui.resultKills.textContent = String(this.kills);
    this.ui.resultDeaths.textContent = String(this.deaths);
    const kd = this.deaths === 0 ? this.kills : this.kills / this.deaths;
    this.ui.resultKd.textContent = kd.toFixed(2);
    this.ui.gameoverScreen.classList.remove('hidden');
  }

  updateScoreHud() {
    this.ui.playerKills.textContent = String(this.kills);
    this.ui.playerDeaths.textContent = `MORTES ${this.deaths}`;
    if (this.botManager) {
      this.ui.botsAlive.textContent = String(this.botManager.getAliveCount());
    }
  }

  updateHealthHud(health, armor) {
    const roundedHealth = Math.max(0, Math.ceil(health));
    const roundedArmor = Math.max(0, Math.ceil(armor));
    this.ui.health.textContent = String(roundedHealth);
    this.ui.armor.textContent = String(roundedArmor);

    const healthStat = this.ui.health.closest('.hud-stat');
    if (healthStat) {
      healthStat.classList.toggle('danger', roundedHealth <= 25);
    }

    this.ui.lowHealthVignette.classList.toggle(
      'active',
      roundedHealth > 0 && roundedHealth <= 34,
    );
  }

  updateAmmoHud({ weapon, clip, reserve, reloading }) {
    this.ui.weaponName.textContent = weapon.name;
    this.ui.ammoClip.textContent = String(clip).padStart(2, '0');
    this.ui.ammoReserve.textContent = String(reserve).padStart(2, '0');
    this.ui.ammoClip.classList.toggle('low', clip <= 5);
    this.ui.reloadHint.classList.toggle(
      'hidden',
      reloading || clip > 0 || reserve <= 0,
    );
  }

  handleReloadState(reloading) {
    if (reloading) {
      this.reloadHintActive = true;
      this.showHint('RECARREGANDO...', 0);
      this.ui.reloadHint.classList.add('hidden');
    } else if (this.reloadHintActive) {
      this.reloadHintActive = false;
      this.clearHint();
    }
  }

  showHint(text, duration = 0) {
    if (!text) {
      this.clearHint();
      return;
    }

    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }

    this.ui.centerHint.textContent = text;
    this.ui.centerHint.classList.remove('hidden');

    if (duration > 0) {
      this.hintTimer = window.setTimeout(() => {
        this.ui.centerHint.classList.add('hidden');
        this.hintTimer = null;
      }, duration);
    }
  }

  clearHint() {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.ui.centerHint.classList.add('hidden');
  }

  updateCrosshair() {
    if (!this.player) return;
    const gap = this.player.getCrosshairGap();
    this.ui.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  addKillFeed(attacker, victim, weapon, headshot = false, playerKill = false) {
    const line = document.createElement('div');
    line.className = `kill-line${playerKill ? ' is-player-kill' : ''}`;

    const attackerEl = document.createElement('span');
    attackerEl.className = 'attacker';
    attackerEl.textContent = attacker;

    const weaponEl = document.createElement('span');
    weaponEl.className = 'weapon';
    weaponEl.textContent = `[${weapon}]`;

    const victimEl = document.createElement('span');
    victimEl.className = 'victim';
    victimEl.textContent = victim;

    line.append(attackerEl, weaponEl);
    if (headshot) {
      const hs = document.createElement('span');
      hs.className = 'hs';
      hs.textContent = 'HS';
      line.append(hs);
    }
    line.append(victimEl);

    this.ui.killFeed.prepend(line);
    while (this.ui.killFeed.children.length > 6) {
      this.ui.killFeed.lastElementChild.remove();
    }

    window.setTimeout(() => {
      line.classList.add('fading');
      window.setTimeout(() => line.remove(), 320);
    }, 6200);
  }

  handlePlayerDamage(info) {
    this.ui.damageVignette.classList.remove('hit');
    void this.ui.damageVignette.offsetWidth;
    this.ui.damageVignette.classList.add('hit');
    window.setTimeout(() => this.ui.damageVignette.classList.remove('hit'), 80);

    if (info.health <= 34) {
      this.ui.lowHealthVignette.classList.add('active');
    }
  }

  handlePlayerDeath(info) {
    if (this.state !== 'playing') return;

    this.deaths += 1;
    this.updateScoreHud();

    const sourceName = info.source?.name || 'BOT';
    const weaponName = info.source?.lastWeapon || 'AK-47';
    const isHeadshot = info.part === 'head';

    this.addKillFeed(
      sourceName,
      'VOCÊ',
      weaponName,
      isHeadshot,
      false,
    );

    this.ui.deathCredit.textContent = isHeadshot
      ? `${sourceName} — HEADSHOT`
      : sourceName;

    this.respawnCountdown = 3.2;
    this.ui.respawnCountdown.textContent = '3';
    this.ui.deathScreen.classList.remove('hidden');
    this.clearHint();
    this.ui.reloadHint.classList.add('hidden');
    this.audio.playKill();
  }

  updatePlayerRespawn(dt) {
    if (this.player.alive) return;

    this.respawnCountdown -= dt;
    this.ui.respawnCountdown.textContent = String(Math.max(0, Math.ceil(this.respawnCountdown)));

    if (this.respawnCountdown > 0) return;

    const spawn = this.pickPlayerSpawn();
    this.player.respawn(spawn);
    this.ui.deathScreen.classList.add('hidden');
    this.ui.lowHealthVignette.classList.remove('active');
    this.ui.health.closest('.hud-stat')?.classList.remove('danger');
    this.updateScoreHud();
    this.drawRadar();
  }

  clearDamageEffects() {
    this.ui.damageVignette.classList.remove('hit');
    this.ui.lowHealthVignette.classList.remove('active');
  }

  updateHudLive(dt) {
    this.updateCrosshair();

    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.12;

    this.updateScoreHud();
    this.drawRadar();

    if (this.player.alive && this.player.ammoState.clip === 0 && this.player.ammoState.reserve === 0) {
      this.showHint('SEM MUNIÇÃO', 1200);
    }
  }

  updateMatch(dt) {
    if (this.state !== 'playing') return;

    const previousTime = Math.ceil(this.matchTime);
    this.matchTime = Math.max(0, this.matchTime - dt);
    const currentTime = Math.ceil(this.matchTime);
    if (previousTime !== currentTime) {
      this.ui.roundTimer.textContent = formatTime(this.matchTime);
    }

    if (this.endAfter > 0) {
      this.endAfter -= dt;
      if (this.endAfter <= 0) {
        this.endMatch('kills');
        return;
      }
    }

    if (this.matchTime <= 0) {
      this.endMatch('time');
    }
  }

  updateAtmosphere(dt) {
    if (!this.dust) return;
    this.dustTime += dt;
    this.dust.rotation.y += dt * 0.0035;
    this.dust.position.y = Math.sin(this.dustTime * 0.08) * 0.12;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  showFatal(message) {
    this.ui.fatalError.textContent = message;
    this.ui.fatalError.classList.remove('hidden');
    window.setTimeout(() => this.ui.fatalError.classList.add('hidden'), 5000);
  }

  drawRadar() {
    const ctx = this.ui.radar.getContext('2d');
    if (!ctx) return;

    const size = this.ui.radar.width;
    const padding = 11;
    const scale = Math.min(
      (size - padding * 2) / (MAP_MAX_X - MAP_MIN_X),
      (size - padding * 2) / (MAP_MAX_Z - MAP_MIN_Z),
    );
    const cx = size / 2;
    const cy = size / 2;
    const toX = (x) => cx + x * scale;
    const toY = (z) => cy + z * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0b130b';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.rect(toX(MAP_MIN_X), toY(MAP_MIN_Z), (MAP_MAX_X - MAP_MIN_X) * scale, (MAP_MAX_Z - MAP_MIN_Z) * scale);
    ctx.clip();

    // Grade de radar.
    ctx.strokeStyle = 'rgba(133, 175, 111, 0.075)';
    ctx.lineWidth = 1;
    for (let x = -30; x <= 30; x += 5) {
      ctx.beginPath();
      ctx.moveTo(toX(x), toY(MAP_MIN_Z));
      ctx.lineTo(toX(x), toY(MAP_MAX_Z));
      ctx.stroke();
    }
    for (let z = -20; z <= 20; z += 5) {
      ctx.beginPath();
      ctx.moveTo(toX(MAP_MIN_X), toY(z));
      ctx.lineTo(toX(MAP_MAX_X), toY(z));
      ctx.stroke();
    }

    // Blocos do mapa.
    ctx.fillStyle = 'rgba(130, 160, 108, 0.2)';
    ctx.strokeStyle = 'rgba(146, 181, 118, 0.26)';
    ctx.lineWidth = 0.7;
    for (const box of this.map.colliders) {
      const x = toX(box.minX);
      const y = toY(box.minZ);
      const w = Math.max(1, (box.maxX - box.minX) * scale);
      const h = Math.max(1, (box.maxZ - box.minZ) * scale);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Marcadores de site.
    ctx.fillStyle = 'rgba(238, 155, 50, 0.3)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A', toX(18.5), toY(-16) + 3);
    ctx.fillText('B', toX(-20.5), toY(-16) + 3);

    // Contatos inimigos.
    const contacts = this.botManager.getRadarContacts(this.camera.position);
    for (const contact of contacts) {
      const x = toX(contact.x);
      const y = toY(contact.z);
      if (contact.visible) {
        ctx.fillStyle = '#f05540';
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 218, 170, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(240, 85, 64, 0.42)';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    if (contacts.some((contact) => contact.visible)) {
      this.ui.radarStatus.textContent = 'CONTATO';
    } else {
      this.ui.radarStatus.textContent = 'LOCAL';
    }

    // Jogador: seta amarela que gira com a câmera.
    ctx.save();
    ctx.translate(toX(this.player.body.position.x), toY(this.player.body.position.z));
    ctx.rotate(-this.camera.rotation.y);
    ctx.fillStyle = this.player.alive ? '#f1d676' : '#80785e';
    ctx.strokeStyle = 'rgba(19, 16, 8, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.7, 5);
    ctx.lineTo(0, 2.8);
    ctx.lineTo(-4.7, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Moldura interna.
    ctx.strokeStyle = 'rgba(145, 183, 112, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 4.5, size - 9, size - 9);
  }

  /* =======================================================
     Disparos / impactos / efeitos
     ======================================================= */

  handlePlayerShot({ origin, direction, weapon }) {
    this.raycaster = this.raycaster || new THREE.Raycaster();
    this.raycaster.set(origin, direction);
    this.raycaster.far = weapon.range;

    const hitboxes = this.botManager.getHitboxes();
    const botHits = this.raycaster.intersectObjects(hitboxes, false);
    const worldHits = this.raycaster.intersectObjects(this.map.occluders, false);

    const botHit = botHits.find((hit) => hit.object.userData.bot?.alive) || null;
    const worldHit = worldHits[0] || null;
    const botIsCloser = botHit && (!worldHit || botHit.distance < worldHit.distance);

    let endPoint;
    if (botIsCloser) {
      const bot = botHit.object.userData.bot;
      const part = botHit.object.userData.part || 'chest';
      const point = botHit.point.clone();
      const normal = botHit.face
        ? botHit.face.normal.clone().transformDirection(botHit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);

      const sourcePosition = new THREE.Vector3(
        this.player.body.position.x,
        0,
        this.player.body.position.z,
      );
      const result = bot.takeDamage(
        weapon.damage,
        part,
        point,
        sourcePosition,
        weapon.name,
      );

      this.spawnBlood(point, normal);
      this.showHitmarker(part === 'head');
      this.audio.playHit(part === 'head');
      endPoint = point;

      if (result.killed) {
        this.kills += 1;
        this.updateScoreHud();
        this.addKillFeed('VOCÊ', bot.name, weapon.name, part === 'head', true);
        this.audio.playKill();

        if (this.kills >= KILL_TARGET) {
          this.endAfter = 1.1;
          this.showHint('ALVO DE ABATES ATINGIDO', 1100);
        }
      }
    } else if (worldHit) {
      endPoint = worldHit.point.clone();
      const normal = worldHit.face
        ? worldHit.face.normal.clone().transformDirection(worldHit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);

      this.addBulletHole(endPoint, normal);
      this.spawnDust(endPoint, normal);
    } else {
      endPoint = origin.clone().addScaledVector(direction, weapon.range);
    }

    const right = new THREE.Vector3()
      .crossVectors(direction, THREE.Object3D.DEFAULT_UP)
      .normalize();
    const tracerStart = origin.clone()
      .addScaledVector(direction, 0.45)
      .addScaledVector(right, 0.14)
      .add(new THREE.Vector3(0, -0.06, 0));
    this.spawnTracer(tracerStart, endPoint, 0xffefbd, 0.065);

    this.botManager.alert(
      new THREE.Vector3(
        this.player.body.position.x,
        0,
        this.player.body.position.z,
      ),
      23,
    );
  }

  handleBotShot({ origin, end, hit, bot }) {
    this.spawnMuzzleFlash(origin);
    this.spawnTracer(origin, end, 0xffc77f, 0.075);
    this.audio.playBotShot(bot.position, this.camera);

    if (hit) {
      this.spawnBlood(end, new THREE.Vector3(0, 1, 0), 5);
    }
  }

  showHitmarker(headshot = false) {
    this.ui.hitmarker.classList.remove('show');
    void this.ui.hitmarker.offsetWidth;
    this.ui.hitmarker.classList.add('show');

    window.clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => {
      this.ui.hitmarker.classList.remove('show');
    }, 85);

    if (headshot) {
      this.ui.headshotFlash.classList.add('show');
      window.clearTimeout(this.headshotTimer);
      this.headshotTimer = window.setTimeout(() => {
        this.ui.headshotFlash.classList.remove('show');
      }, 520);
    }
  }

  spawnTracer(start, end, color = 0xffdfa0, life = 0.07) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.scene.add(line);
    this.effects.push({
      type: 'tracer',
      line,
      life,
      maxLife: life,
    });
  }

  spawnMuzzleFlash(position) {
    if (!this.glowTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 225, 1)');
      gradient.addColorStop(0.25, 'rgba(255, 204, 108, 0.9)');
      gradient.addColorStop(0.62, 'rgba(255, 132, 38, 0.32)');
      gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      this.glowTexture = new THREE.CanvasTexture(canvas);
      this.glowTexture.colorSpace = THREE.SRGBColorSpace;
    }

    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffc46f,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(0.62);
    this.scene.add(sprite);
    this.effects.push({
      type: 'sprite',
      sprite,
      life: 0.06,
      maxLife: 0.06,
      baseScale: 0.62,
    });
  }

  spawnParticles(position, normal, color, count, speed, size, gravity, additive = false) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const normalVector = normal.clone().normalize();

    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 0.06;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.06;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.06;

      const random = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      const direction = random.addScaledVector(normalVector, 1.2).normalize();
      const magnitude = speed * (0.35 + Math.random() * 0.9);

      velocities[i * 3] = direction.x * magnitude + (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = direction.y * magnitude + Math.random() * 0.6;
      velocities[i * 3 + 2] = direction.z * magnitude + (Math.random() - 0.5) * 0.3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);

    this.effects.push({
      type: 'particles',
      points,
      velocities,
      gravity,
      life: 0.45,
      maxLife: 0.45,
    });
  }

  spawnBlood(position, normal, count = 9) {
    this.spawnParticles(
      position,
      normal,
      0x8f1b14,
      count,
      2.1,
      0.034,
      7.5,
      false,
    );
  }

  spawnDust(position, normal) {
    this.spawnParticles(
      position,
      normal,
      0xc9b18a,
      7,
      1.45,
      0.03,
      3.2,
      false,
    );
  }

  addBulletHole(point, normal) {
    const decal = new THREE.Mesh(this.bulletHoleGeometry, this.bulletHoleMaterial);
    decal.position.copy(point).addScaledVector(normal, 0.005);
    decal.lookAt(point.clone().add(normal));
    decal.renderOrder = 2;
    this.scene.add(decal);
    this.decals.push(decal);

    if (this.decals.length > 70) {
      const old = this.decals.shift();
      this.scene.remove(old);
    }
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life -= dt;
      const ratio = Math.max(0, effect.life / effect.maxLife);

      if (effect.type === 'tracer') {
        effect.line.material.opacity = ratio * 0.72;
      } else if (effect.type === 'sprite') {
        effect.sprite.material.opacity = ratio * 0.92;
        effect.sprite.scale.setScalar(effect.baseScale * (1 + (1 - ratio) * 1.8));
      } else if (effect.type === 'particles') {
        const positions = effect.points.geometry.attributes.position.array;
        for (let p = 0; p < effect.velocities.length / 3; p += 1) {
          effect.velocities[p * 3 + 1] -= effect.gravity * dt;
          positions[p * 3] += effect.velocities[p * 3] * dt;
          positions[p * 3 + 1] += effect.velocities[p * 3 + 1] * dt;
          positions[p * 3 + 2] += effect.velocities[p * 3 + 2] * dt;
        }
        effect.points.geometry.attributes.position.needsUpdate = true;
        effect.points.material.opacity = ratio * 0.9;
      }

      if (effect.life <= 0) {
        this.removeEffect(effect);
        this.effects.splice(i, 1);
      }
    }
  }

  removeEffect(effect) {
    if (effect.type === 'tracer') {
      this.scene.remove(effect.line);
      effect.line.geometry.dispose();
      effect.line.material.dispose();
    } else if (effect.type === 'sprite') {
      this.scene.remove(effect.sprite);
      effect.sprite.material.dispose();
    } else if (effect.type === 'particles') {
      this.scene.remove(effect.points);
      effect.points.geometry.dispose();
      effect.points.material.dispose();
    }
  }

  clearEffects() {
    for (const effect of this.effects) {
      this.removeEffect(effect);
    }
    this.effects.length = 0;

    for (const decal of this.decals) {
      this.scene.remove(decal);
    }
    this.decals.length = 0;

    for (const grenade of this.grenades) {
      grenade.remove();
    }
    this.grenades.length = 0;
  }

  spawnGrenade({ position, velocity }) {
    const grenade = new Grenade({
      world: this.world,
      scene: this.scene,
      position,
      velocity,
      type: 'he',
      owner: this.player,
      game: this,
    });
    this.grenades.push(grenade);
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i -= 1) {
      const g = this.grenades[i];
      g.update(dt);
      if (g.removed) {
        this.grenades.splice(i, 1);
      }
    }
  }

  /* =======================================================
     Loop principal
     ======================================================= */

  animate() {
    requestAnimationFrame(this.animate);

    const rawDt = Math.min(this.clock.getDelta(), 0.35);
    const dt = Math.min(rawDt, 0.05);
    this.updateAtmosphere(dt);

    if (this.state === 'playing') {
      this.accumulator += dt;
      let steps = 0;

      while (this.accumulator >= FIXED_DT && steps < 10) {
        this.player.fixedUpdate(FIXED_DT);
        this.world.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps += 1;
      }

      if (steps >= 10) this.accumulator = 0;

      this.player.updateVisual(dt);
      this.botManager.update(dt);
      this.updateMatch(rawDt);

      if (!this.player.alive) {
        this.updatePlayerRespawn(rawDt);
      }

      this.updateEffects(dt);
      this.updateGrenades(dt);
      this.updateHudLive(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

/* =========================================================
   Bootstrap
   ========================================================= */

try {
  window.game = new Game();
} catch (error) {
  console.error(error);
  const fatal = document.getElementById('fatal-error');
  if (fatal) {
    fatal.textContent = `Não foi possível iniciar o jogo: ${error.message}`;
    fatal.classList.remove('hidden');
  }
}
