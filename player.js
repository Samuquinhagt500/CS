import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as CANNON from 'cannon-es';

/**
 * Estatísticas das armas.
 *
 * As unidades de spread estão em radianos. Os valores foram escolhidos para
 * reproduzir a sensação do CS 1.6: o primeiro tiro parado é muito preciso,
 * andar castiga a mira e o spray do AK sobe de forma progressiva.
 */
export const WEAPONS = {
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    slot: 1,
    damage: 28,
    rpm: 600,
    automatic: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.45,
    range: 120,
    baseSpread: 0.00065,
    moveSpread: 0.052,
    airSpread: 0.095,
    crouchMultiplier: 0.72,
    bloomPerShot: 0.0018,
    maxBloom: 0.042,
    recoilRandom: 0.22,
    headMultiplier: 4,
    // Recuo cumulativo em graus [horizontal, vertical].
    recoilPattern: [
      [0, 0], [0.04, 0.72], [-0.05, 1.43], [0.1, 2.12], [-0.09, 2.82],
      [0.18, 3.52], [0.32, 4.18], [0.48, 4.78], [0.56, 5.33], [0.53, 5.86],
      [0.35, 6.36], [0.04, 6.84], [-0.31, 7.31], [-0.61, 7.78], [-0.75, 8.22],
      [-0.65, 8.65], [-0.31, 9.07], [0.17, 9.5], [0.61, 9.91], [0.9, 10.31],
      [0.94, 10.7], [0.69, 11.08], [0.22, 11.44], [-0.39, 11.8], [-0.91, 12.15],
      [-1.17, 12.49], [-1.04, 12.81], [-0.57, 13.12], [0.11, 13.43], [0.84, 13.72],
    ],
  },

  m4a1: {
    id: 'm4a1',
    name: 'M4A1',
    slot: 1,
    damage: 24,
    rpm: 666,
    automatic: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.3,
    range: 120,
    baseSpread: 0.00055,
    moveSpread: 0.047,
    airSpread: 0.09,
    crouchMultiplier: 0.72,
    bloomPerShot: 0.0016,
    maxBloom: 0.036,
    recoilRandom: 0.18,
    headMultiplier: 4,
    recoilPattern: [
      [0, 0], [0.02, 0.62], [-0.03, 1.24], [0.06, 1.84], [-0.05, 2.42],
      [0.1, 2.98], [0.17, 3.52], [0.24, 4.04], [0.27, 4.54], [0.24, 5.02],
      [0.12, 5.48], [-0.05, 5.92], [-0.24, 6.34], [-0.38, 6.74], [-0.42, 7.12],
      [-0.35, 7.48], [-0.17, 7.82], [0.08, 8.14], [0.34, 8.44], [0.48, 8.72],
    ],
  },

  awp: {
    id: 'awp',
    name: 'AWP',
    slot: 1,
    damage: 95,
    rpm: 41,
    automatic: false,
    magazine: 10,
    reserve: 30,
    reloadTime: 3.4,
    range: 180,
    baseSpread: 0.00025,
    moveSpread: 0.135,
    airSpread: 0.24,
    crouchMultiplier: 0.6,
    bloomPerShot: 0.008,
    maxBloom: 0.09,
    recoilRandom: 0.04,
    headMultiplier: 1.5,
    recoilPattern: [
      [0, 0], [0.12, 5.4], [-0.2, 9.2], [0.24, 12.2],
    ],
  },

  usp: {
    id: 'usp',
    name: 'USP',
    slot: 2,
    damage: 22,
    rpm: 352,
    automatic: false,
    magazine: 12,
    reserve: 24,
    reloadTime: 2.15,
    range: 80,
    baseSpread: 0.0012,
    moveSpread: 0.046,
    airSpread: 0.11,
    crouchMultiplier: 0.78,
    bloomPerShot: 0.0024,
    maxBloom: 0.028,
    recoilRandom: 0.12,
    headMultiplier: 4,
    recoilPattern: [
      [0, 0], [0.05, 0.95], [-0.08, 1.68], [0.11, 2.25], [-0.1, 2.76],
      [0.16, 3.22], [-0.16, 3.63], [0.2, 4.0], [-0.2, 4.33], [0.22, 4.64],
      [-0.18, 4.92], [0.14, 5.18],
    ],
  },

  deagle: {
    id: 'deagle',
    name: 'DESERT EAGLE',
    slot: 2,
    damage: 40,
    rpm: 267,
    automatic: false,
    magazine: 7,
    reserve: 35,
    reloadTime: 2.25,
    range: 100,
    baseSpread: 0.0009,
    moveSpread: 0.058,
    airSpread: 0.12,
    crouchMultiplier: 0.74,
    bloomPerShot: 0.011,
    maxBloom: 0.055,
    recoilRandom: 0.1,
    headMultiplier: 4,
    recoilPattern: [
      [0, 0], [0.28, 2.35], [-0.34, 4.2], [0.3, 5.7], [-0.24, 6.9],
      [0.18, 7.9], [-0.12, 8.6],
    ],
  },
};

// Ordem usada pela roda do mouse. As teclas 1–5 selecionam diretamente.
const WEAPON_ORDER = ['ak47', 'm4a1', 'awp', 'usp', 'deagle'];

const TAU = Math.PI * 2;
const PLAYER_RADIUS = 0.4;
const EYE_STAND = 1.22; // relativo ao centro da esfera de física
const EYE_CROUCH = 0.7;
const MAX_PITCH = Math.PI / 2 - 0.03;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function damp(current, target, speed, dt) {
  return lerp(current, target, 1 - Math.exp(-speed * dt));
}

function randomDisk() {
  const angle = Math.random() * TAU;
  const radius = Math.sqrt(Math.random());
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Jogador em primeira pessoa.
 *
 * A movimentação horizontal usa um modelo Quake/CS (fricção no chão +
 * aceleração aérea limitada). A colisão e a gravidade ficam a cargo do
 * cannon-es; a câmera e a arma são atualizadas visualmente no Three.js.
 */
export class Player {
  constructor({
    camera,
    domElement,
    world,
    scene,
    audio = null,
    spawn = { x: 0, z: 17, yaw: 0 },
    callbacks = {},
  }) {
    this.camera = camera;
    this.domElement = domElement;
    this.world = world;
    this.scene = scene;
    this.audio = audio;
    this.callbacks = callbacks;

    this.camera.near = 0.035;
    this.camera.far = 240;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, spawn.yaw, 0);

    this.controls = new PointerLockControls(this.camera, domElement);
    this.controls.pointerSpeed = 1;
    this.sensitivity = 1;

    this.radius = PLAYER_RADIUS;
    this.eyeOffset = EYE_STAND;
    this.targetEyeOffset = EYE_STAND;
    this.maxSpeed = 5.6;
    this.walkSpeed = 2.35;
    this.crouchSpeed = 1.55;
    this.groundAccel = 8.5;
    this.airAccel = 10.5;
    this.airWishCap = 0.72;
    this.friction = 5.6;
    this.stopSpeed = 1.9;
    this.jumpVelocity = 6.15;
    this.maxHorizontalSpeed = 9.4;

    this.body = new CANNON.Body({
      mass: 74,
      shape: new CANNON.Sphere(this.radius),
      material: new CANNON.Material('player'),
      fixedRotation: true,
      linearDamping: 0,
      angularDamping: 1,
      allowSleep: false,
      collisionFilterGroup: 2,
      collisionFilterMask: 1,
    });
    this.body.position.set(spawn.x, 0.45, spawn.z);
    this.body.updateMassProperties();
    world.addBody(this.body);

    this.groundResult = new CANNON.RaycastResult();
    this.groundNormal = new CANNON.Vec3();
    this.grounded = false;
    this.wasGrounded = false;
    this.fallVelocity = 0;
    this.spawnPoint = { ...spawn };

    this.keys = {
      forward: false,
      back: false,
      left: false,
      right: false,
      walk: false,
      crouch: false,
      jump: false,
    };

    this.triggerDown = false;
    this.semiLatch = false;
    this.alive = true;
    this.health = 100;
    this.armor = 100;
    this.time = 0;
    this.lastDamageAt = -99;

    this.currentWeaponId = 'ak47';
    this.ammo = {};
    for (const [id, weapon] of Object.entries(WEAPONS)) {
      this.ammo[id] = { clip: weapon.magazine, reserve: weapon.reserve };
    }

    this.reloading = false;
    this.reloadElapsed = 0;
    this.nextFireAt = 0;
    this.lastShotAt = -99;
    this.lastEmptyAt = -99;
    this.grenadeCooldown = 0;
    this.shotIndex = 0;
    this.bloom = 0;
    this.deployTimer = 0;
    this.deployDuration = 0.42;

    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.trauma = 0;
    this.landDip = 0;

    this.bobPhase = 0;
    this.footstepDistance = 0;
    this.viewKick = 0;
    this.viewSwayX = 0;
    this.viewSwayY = 0;
    this.muzzleTimer = 0;

    // Proteção de spawn: o jogador fica invulnerável e os bots o ignoram.
    this.spawnProtection = 0;
    this.spawnProtectionDuration = 4.5;

    // Mira telescópica da AWP (botão direito).
    this.scoped = false;
    this.scopeProgress = 0;
    this.baseFov = camera.fov;
    this.scopeFov = 22;

    this.weaponModels = {
      ak47: this.createAK47(),
      m4a1: this.createM4A1(),
      awp: this.createAWP(),
      usp: this.createUSP(),
      deagle: this.createDeagle(),
    };
    for (const model of Object.values(this.weaponModels)) {
      model.visible = false;
      this.camera.add(model);
    }
    this.weaponModels.ak47.visible = true;

    this.bindInput();
    this.updateWeaponVisibility();
    this.setCameraFromPhysics(0);
    this.emitHealth();
    this.emitAmmo();
  }

  /* =======================================================
     Modelos de arma (low-poly, presos à câmera)
     ======================================================= */

  weaponMaterial(color, metalness = 0.5, roughness = 0.5) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }

  createAK47() {
    const group = new THREE.Group();
    const steel = this.weaponMaterial(0x292824, 0.72, 0.42);
    const dark = this.weaponMaterial(0x151513, 0.55, 0.6);
    const wood = this.weaponMaterial(0x6f3d1e, 0.05, 0.85);
    const woodDark = this.weaponMaterial(0x4c2916, 0.04, 0.9);
    const glove = this.weaponMaterial(0x171714, 0.1, 0.95);

    // Receptor principal.
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.42), steel);
    receiver.position.set(0, 0, -0.08);
    group.add(receiver);

    // Guarda-mão de madeira.
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.085, 0.28), wood);
    handguard.position.set(0, 0.008, -0.31);
    group.add(handguard);

    const upperGuard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.24), woodDark);
    upperGuard.position.set(0, 0.07, -0.3);
    group.add(upperGuard);

    // Cano.
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.36, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.48);
    group.add(barrel);

    const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.25, 6), steel);
    gasTube.rotation.x = Math.PI / 2;
    gasTube.position.set(0, 0.06, -0.37);
    group.add(gasTube);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.055, 0.025), dark);
    frontSight.position.set(0, 0.065, -0.58);
    group.add(frontSight);

    // Coronha.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.14, 0.3), wood);
    stock.position.set(0, -0.015, 0.25);
    stock.rotation.x = 0.08;
    group.add(stock);

    const stockButt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.17, 0.045), woodDark);
    stockButt.position.set(0, -0.005, 0.405);
    group.add(stockButt);

    // Carregador curvo simplificado em duas peças.
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.09), dark);
    magazine.position.set(0, -0.15, -0.05);
    magazine.rotation.x = -0.16;
    group.add(magazine);

    const magazineLip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.1), steel);
    magazineLip.position.set(0, -0.255, -0.032);
    magazineLip.rotation.x = -0.16;
    group.add(magazineLip);

    // Empunhadura.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
    grip.position.set(0, -0.12, 0.09);
    grip.rotation.x = -0.28;
    group.add(grip);

    // Mãos.
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.13), glove);
    rightHand.position.set(0.025, -0.15, 0.055);
    rightHand.rotation.x = -0.2;
    group.add(rightHand);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.09), glove);
    wrist.position.set(0.065, -0.195, 0.105);
    wrist.rotation.x = -0.55;
    group.add(wrist);

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14), glove);
    leftHand.position.set(-0.015, -0.07, -0.31);
    leftHand.rotation.x = 0.08;
    group.add(leftHand);

    const leftWrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.09), glove);
    leftWrist.position.set(-0.055, -0.15, -0.24);
    leftWrist.rotation.set(-0.2, 0, -0.3);
    group.add(leftWrist);

    // Mira traseira.
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.02), dark);
    rearSight.position.set(0, 0.085, -0.02);
    group.add(rearSight);

    const flash = this.createMuzzleFlash(0.07);
    flash.position.set(0, 0.028, -0.665);
    group.add(flash);
    group.userData.flash = flash;

    group.scale.setScalar(0.68);
    group.position.set(0.3, -0.245, -0.51);
    group.rotation.set(0.015, -0.035, -0.012);
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    return group;
  }

  createUSP() {
    const group = new THREE.Group();
    const steel = this.weaponMaterial(0x33332f, 0.78, 0.38);
    const dark = this.weaponMaterial(0x171715, 0.62, 0.5);
    const glove = this.weaponMaterial(0x191916, 0.1, 0.95);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.07, 0.29), steel);
    slide.position.set(0, 0.01, -0.065);
    group.add(slide);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.055, 0.22), dark);
    frame.position.set(0, -0.052, -0.02);
    group.add(frame);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 7), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.245);
    group.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), dark);
    grip.position.set(0, -0.13, 0.075);
    grip.rotation.x = -0.22;
    group.add(grip);

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.13), glove);
    hand.position.set(0.02, -0.15, 0.06);
    hand.rotation.x = -0.2;
    group.add(hand);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.09), glove);
    wrist.position.set(0.06, -0.195, 0.11);
    wrist.rotation.x = -0.55;
    group.add(wrist);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), steel);
    sight.position.set(0, 0.055, -0.18);
    group.add(sight);

    const flash = this.createMuzzleFlash(0.045);
    flash.position.set(0, 0.014, -0.31);
    group.add(flash);
    group.userData.flash = flash;

    group.scale.setScalar(0.82);
    group.position.set(0.245, -0.24, -0.46);
    group.rotation.set(0.02, -0.02, -0.015);
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    return group;
  }

  createM4A1() {
    const group = new THREE.Group();
    const steel = this.weaponMaterial(0x2b2d2a, 0.72, 0.44);
    const dark = this.weaponMaterial(0x141514, 0.52, 0.62);
    const polymer = this.weaponMaterial(0x24251f, 0.18, 0.82);
    const glove = this.weaponMaterial(0x171714, 0.1, 0.95);

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.12, 0.4), steel);
    receiver.position.set(0, 0, -0.07);
    group.add(receiver);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.028, 0.32), dark);
    rail.position.set(0, 0.072, -0.09);
    group.add(rail);

    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.27), polymer);
    handguard.position.set(0, 0.005, -0.31);
    group.add(handguard);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.36, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.49);
    group.add(barrel);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.06, 0.028), dark);
    frontSight.position.set(0, 0.068, -0.64);
    group.add(frontSight);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.12, 0.26), polymer);
    stock.position.set(0, -0.004, 0.235);
    stock.rotation.x = 0.04;
    group.add(stock);

    const stockButt = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.15, 0.04), dark);
    stockButt.position.set(0, 0, 0.38);
    group.add(stockButt);

    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.18, 0.085), dark);
    magazine.position.set(0, -0.14, -0.035);
    magazine.rotation.x = -0.08;
    group.add(magazine);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.09), polymer);
    grip.position.set(0, -0.11, 0.075);
    grip.rotation.x = -0.28;
    group.add(grip);

    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.13), glove);
    rightHand.position.set(0.025, -0.15, 0.05);
    rightHand.rotation.x = -0.2;
    group.add(rightHand);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.09), glove);
    wrist.position.set(0.065, -0.195, 0.1);
    wrist.rotation.x = -0.55;
    group.add(wrist);

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14), glove);
    leftHand.position.set(-0.012, -0.065, -0.31);
    leftHand.rotation.x = 0.08;
    group.add(leftHand);

    const leftWrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.09), glove);
    leftWrist.position.set(-0.052, -0.145, -0.24);
    leftWrist.rotation.set(-0.2, 0, -0.3);
    group.add(leftWrist);

    const flash = this.createMuzzleFlash(0.06);
    flash.position.set(0, 0.026, -0.68);
    group.add(flash);
    group.userData.flash = flash;

    group.scale.setScalar(0.68);
    group.position.set(0.3, -0.245, -0.51);
    group.rotation.set(0.015, -0.035, -0.012);
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    return group;
  }

  createAWP() {
    const group = new THREE.Group();
    const steel = this.weaponMaterial(0x1d1f1b, 0.72, 0.48);
    const dark = this.weaponMaterial(0x101110, 0.55, 0.6);
    const olive = this.weaponMaterial(0x4c5238, 0.06, 0.86);
    const glass = new THREE.MeshStandardMaterial({
      color: 0x7fb7c9,
      metalness: 0.4,
      roughness: 0.12,
      emissive: 0x1b3d49,
      emissiveIntensity: 0.35,
    });
    const glove = this.weaponMaterial(0x171714, 0.1, 0.95);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.5), olive);
    body.position.set(0, 0, -0.05);
    group.add(body);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.17, 0.4), olive);
    stock.position.set(0, -0.025, 0.34);
    group.add(stock);

    const stockButt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.05), dark);
    stockButt.position.set(0, -0.025, 0.55);
    group.add(stockButt);

    const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.045, 0.17), dark);
    cheekRest.position.set(0, 0.08, 0.25);
    group.add(cheekRest);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.54, 9), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.56);
    group.add(barrel);

    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 8), dark);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0.03, -0.85);
    group.add(muzzleBrake);

    const scopeMount = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.24), dark);
    scopeMount.position.set(0, 0.1, -0.07);
    group.add(scopeMount);

    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.31, 12), steel);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.145, -0.08);
    group.add(scope);

    const scopeFront = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.031, 0.055, 12), dark);
    scopeFront.rotation.x = Math.PI / 2;
    scopeFront.position.set(0, 0.145, -0.26);
    group.add(scopeFront);

    const scopeRear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.031, 0.055, 12), dark);
    scopeRear.rotation.x = Math.PI / 2;
    scopeRear.position.set(0, 0.145, 0.1);
    group.add(scopeRear);

    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 12), glass);
    lens.position.set(0, 0.145, -0.289);
    lens.rotation.y = Math.PI;
    group.add(lens);

    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.12), dark);
    magazine.position.set(0, -0.13, -0.02);
    group.add(magazine);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), olive);
    grip.position.set(0, -0.12, 0.11);
    grip.rotation.x = -0.28;
    group.add(grip);

    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.13), glove);
    rightHand.position.set(0.025, -0.155, 0.09);
    rightHand.rotation.x = -0.2;
    group.add(rightHand);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.09), glove);
    wrist.position.set(0.065, -0.2, 0.14);
    wrist.rotation.x = -0.55;
    group.add(wrist);

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.15), glove);
    leftHand.position.set(-0.015, -0.075, -0.3);
    leftHand.rotation.x = 0.1;
    group.add(leftHand);

    const leftWrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.09), glove);
    leftWrist.position.set(-0.055, -0.155, -0.22);
    leftWrist.rotation.set(-0.2, 0, -0.32);
    group.add(leftWrist);

    const flash = this.createMuzzleFlash(0.085);
    flash.position.set(0, 0.03, -0.93);
    group.add(flash);
    group.userData.flash = flash;

    group.scale.setScalar(0.6);
    group.position.set(0.27, -0.275, -0.63);
    group.rotation.set(0.01, -0.03, -0.008);
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    return group;
  }

  createDeagle() {
    const group = new THREE.Group();
    const gold = this.weaponMaterial(0x6f6246, 0.86, 0.32);
    const steel = this.weaponMaterial(0x43423a, 0.8, 0.4);
    const dark = this.weaponMaterial(0x161614, 0.6, 0.55);
    const glove = this.weaponMaterial(0x191916, 0.1, 0.95);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.082, 0.32), gold);
    slide.position.set(0, 0.015, -0.08);
    group.add(slide);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.016, 0.27), steel);
    rail.position.set(0, 0.062, -0.08);
    group.add(rail);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.06, 0.24), dark);
    frame.position.set(0, -0.052, -0.04);
    group.add(frame);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.12, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.27);
    group.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.1), dark);
    grip.position.set(0, -0.15, 0.075);
    grip.rotation.x = -0.22;
    group.add(grip);

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.13), glove);
    hand.position.set(0.02, -0.16, 0.06);
    hand.rotation.x = -0.2;
    group.add(hand);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.09), glove);
    wrist.position.set(0.06, -0.205, 0.11);
    wrist.rotation.x = -0.55;
    group.add(wrist);

    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, 0.02), dark);
    rearSight.position.set(0, 0.062, 0.06);
    group.add(rearSight);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.018), dark);
    frontSight.position.set(0, 0.065, -0.235);
    group.add(frontSight);

    const flash = this.createMuzzleFlash(0.055);
    flash.position.set(0, 0.012, -0.35);
    group.add(flash);
    group.userData.flash = flash;

    group.scale.setScalar(0.86);
    group.position.set(0.25, -0.245, -0.47);
    group.rotation.set(0.02, -0.02, -0.015);
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    return group;
  }

  createMuzzleFlash(size) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd37b,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 6), material);
    mesh.visible = false;
    return mesh;
  }

  /* =======================================================
     Input
     ======================================================= */

  bindInput() {
    this.onKeyDown = (event) => {
      if (!this.controls.isLocked) return;

      switch (event.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.back = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.walk = true;
          break;
        case 'ControlLeft':
        case 'ControlRight':
        case 'KeyC':
          this.keys.crouch = true;
          break;
        case 'Space':
          this.keys.jump = true;
          event.preventDefault();
          break;
        case 'KeyR':
          this.startReload();
          break;
        case 'KeyG':
          this.throwGrenade();
          break;
        case 'Digit1':
          this.switchWeapon('ak47');
          break;
        case 'Digit2':
          this.switchWeapon('m4a1');
          break;
        case 'Digit3':
          this.switchWeapon('awp');
          break;
        case 'Digit4':
          this.switchWeapon('usp');
          break;
        case 'Digit5':
          this.switchWeapon('deagle');
          break;
        default:
          break;
      }
    };

    this.onKeyUp = (event) => {
      switch (event.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.back = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.walk = false;
          break;
        case 'ControlLeft':
        case 'ControlRight':
        case 'KeyC':
          this.keys.crouch = false;
          break;
        case 'Space':
          this.keys.jump = false;
          break;
        default:
          break;
      }
    };

    this.onMouseDown = (event) => {
      if (!this.controls.isLocked) return;
      if (event.button === 2) {
        this.toggleScope();
        return;
      }
      if (event.button !== 0) return;
      this.triggerDown = true;
      this.semiLatch = false;
    };

    this.onMouseUp = (event) => {
      if (event.button !== 0) return;
      this.triggerDown = false;
      this.semiLatch = false;
    };

    this.onWheel = (event) => {
      if (!this.controls.isLocked) return;
      event.preventDefault();
      const index = WEAPON_ORDER.indexOf(this.currentWeaponId);
      const direction = event.deltaY > 0 ? 1 : -1;
      const next = (index + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      this.switchWeapon(WEAPON_ORDER[next]);
    };

    this.onContextMenu = (event) => event.preventDefault();
    this.onWindowBlur = () => this.clearInput();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onWindowBlur);

    this.controls.addEventListener('unlock', () => this.clearInput());
  }

  clearInput() {
    this.keys.forward = false;
    this.keys.back = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.walk = false;
    this.keys.crouch = false;
    this.keys.jump = false;
    this.triggerDown = false;
    this.semiLatch = false;
  }

  setSensitivity(value) {
    this.sensitivity = clamp(Number(value) || 1, 0.15, 4);
    this.controls.pointerSpeed = this.sensitivity;
  }

  lock() {
    this.controls.lock();
  }

  unlock() {
    this.controls.unlock();
  }

  /* =======================================================
     Loop de física / armas
     ======================================================= */

  fixedUpdate(dt) {
    this.time += dt;
    this.spawnProtection = Math.max(0, this.spawnProtection - dt);
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);

    if (!this.alive) {
      this.body.velocity.x *= 0.85;
      this.body.velocity.z *= 0.85;
      return;
    }

    this.updateGroundState();
    this.handleJump();
    this.applyMovement(dt);
    this.updateReload(dt);
    this.updateWeapon(dt);
    this.updateMuzzleTimer(dt);
  }

  updateGroundState() {
    const from = new CANNON.Vec3(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z,
    );
    const to = new CANNON.Vec3(
      this.body.position.x,
      this.body.position.y - (this.radius + 0.14),
      this.body.position.z,
    );

    this.groundResult.reset();
    this.world.raycastClosest(
      from,
      to,
      { collisionFilterMask: 1, skipBackfaces: true },
      this.groundResult,
    );

    this.grounded = this.groundResult.hasHit
      && this.groundResult.hitNormalWorld.y > 0.55
      && this.body.velocity.y <= 0.6;

    if (this.grounded && !this.wasGrounded) {
      if (this.fallVelocity > 3.1) {
        this.addTrauma(clamp(this.fallVelocity * 0.022, 0.04, 0.24));
        this.landDip = clamp(this.fallVelocity * 0.012, 0.015, 0.085);
        this.audio?.playFootstep(0.55);
      }
      this.fallVelocity = 0;
    }

    if (!this.grounded) {
      this.fallVelocity = Math.max(this.fallVelocity, -this.body.velocity.y);
    }

    this.wasGrounded = this.grounded;
  }

  handleJump() {
    if (!this.grounded || !this.keys.jump) return;
    this.body.velocity.y = this.jumpVelocity;
    this.grounded = false;
    this.wasGrounded = false;
    this.fallVelocity = 0;
    this.audio?.playJump();
  }

  getWishDirection() {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      forward.set(0, 0, -1);
    }
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
    const wish = new THREE.Vector3();

    if (this.keys.forward) wish.add(forward);
    if (this.keys.back) wish.sub(forward);
    if (this.keys.right) wish.add(right);
    if (this.keys.left) wish.sub(right);

    if (wish.lengthSq() > 1) wish.normalize();
    return wish;
  }

  getMaxSpeed() {
    if (this.keys.crouch) return this.crouchSpeed;
    if (this.keys.walk) return this.walkSpeed;
    return this.maxSpeed;
  }

  applyMovement(dt) {
    const velocity = this.body.velocity;
    const wish = this.getWishDirection();
    const maxSpeed = this.getMaxSpeed();

    if (this.grounded) {
      this.applyGroundFriction(dt);
      this.accelerate(wish, maxSpeed, this.groundAccel, dt);
    } else {
      this.airAccelerate(wish, maxSpeed, dt);
    }

    const horizontal = Math.hypot(velocity.x, velocity.z);
    if (horizontal > this.maxHorizontalSpeed) {
      const scale = this.maxHorizontalSpeed / horizontal;
      velocity.x *= scale;
      velocity.z *= scale;
    }

    // Agachar suaviza a câmera, mas não altera a esfera de colisão.
    this.targetEyeOffset = this.keys.crouch ? EYE_CROUCH : EYE_STAND;
  }

  applyGroundFriction(dt) {
    const velocity = this.body.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.06) {
      velocity.x = 0;
      velocity.z = 0;
      return;
    }

    const control = Math.max(speed, this.stopSpeed);
    const drop = control * this.friction * dt;
    const newSpeed = Math.max(0, speed - drop);
    const scale = newSpeed / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  accelerate(wish, maxSpeed, accel, dt) {
    if (wish.lengthSq() === 0) return;

    const velocity = this.body.velocity;
    const current = velocity.x * wish.x + velocity.z * wish.z;
    const addSpeed = maxSpeed - current;
    if (addSpeed <= 0) return;

    const accelSpeed = Math.min(accel * maxSpeed * dt, addSpeed);
    velocity.x += wish.x * accelSpeed;
    velocity.z += wish.z * accelSpeed;
  }

  airAccelerate(wish, maxSpeed, dt) {
    if (wish.lengthSq() === 0) return;

    const velocity = this.body.velocity;
    const wishSpeed = Math.min(maxSpeed, this.airWishCap);
    const current = velocity.x * wish.x + velocity.z * wish.z;
    const addSpeed = wishSpeed - current;
    if (addSpeed <= 0) return;

    const accelSpeed = Math.min(this.airAccel * wishSpeed * dt, addSpeed);
    velocity.x += wish.x * accelSpeed;
    velocity.z += wish.z * accelSpeed;
  }

  /* =======================================================
     Recarga / troca / disparo
     ======================================================= */

  get weapon() {
    return WEAPONS[this.currentWeaponId];
  }

  get ammoState() {
    return this.ammo[this.currentWeaponId];
  }

  updateReload(dt) {
    if (!this.reloading) return;

    this.reloadElapsed += dt;
    if (this.reloadElapsed < this.weapon.reloadTime) return;

    const state = this.ammoState;
    const missing = this.weapon.magazine - state.clip;
    const amount = Math.min(missing, state.reserve);
    state.clip += amount;
    state.reserve -= amount;
    this.reloading = false;
    this.reloadElapsed = 0;
    this.shotIndex = 0;
    this.emitAmmo();
    this.callbacks.onReloadState?.(false, true);
  }

  startReload() {
    if (!this.alive || this.reloading) return;

    const state = this.ammoState;
    if (state.clip >= this.weapon.magazine || state.reserve <= 0) return;

    this.reloading = true;
    this.reloadElapsed = 0;
    this.shotIndex = 0;
    this.triggerDown = false;
    this.audio?.playReload(this.weapon.id);
    this.emitAmmo();
    this.callbacks.onReloadState?.(true, false);
  }

  switchWeapon(id) {
    if (!this.alive || id === this.currentWeaponId || !WEAPONS[id]) return;
    if (this.deployTimer < this.deployDuration * 0.4) return;

    this.reloading = false;
    this.reloadElapsed = 0;
    this.currentWeaponId = id;
    this.shotIndex = 0;
    this.bloom = 0;
    this.deployTimer = 0;
    this.triggerDown = false;
    this.semiLatch = false;
    this.nextFireAt = this.time + this.deployDuration;
    this.setScoped(false);
    this.updateWeaponVisibility();
    this.audio?.playSwitch();
    this.callbacks.onWeaponChanged?.(this.weapon);
    this.callbacks.onReloadState?.(false, false);
    this.emitAmmo();
  }

  throwGrenade() {
    if (!this.alive || this.reloading || this.grenadeCooldown > 0) return;
    if (!this.controls.isLocked) return;

    this.grenadeCooldown = 6;

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    origin.y += 0.6;

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    const velocity = direction.clone().multiplyScalar(14);
    velocity.y += 4;

    this.callbacks.onGrenadeThrown?.({
      position: origin.clone(),
      velocity,
    });
  }

  toggleScope() {
    if (!this.alive) return;
    if (this.currentWeaponId !== 'awp') return;
    this.setScoped(!this.scoped);
  }

  setScoped(value) {
    if (value && this.currentWeaponId !== 'awp') return;
    if (this.scoped === value) return;

    this.scoped = value;
    this.triggerDown = false;
    this.semiLatch = false;
    this.updateWeaponVisibility();
    this.callbacks.onScopeChanged?.(value);
  }

  updateWeaponVisibility() {
    const active = this.weaponModels[this.currentWeaponId];
    Object.entries(this.weaponModels).forEach(([id, model]) => {
      const show = id === this.currentWeaponId && !(this.scoped && id === 'awp');
      model.visible = show;
    });
    if (active) active.userData.flash.visible = false;
  }

  updateWeapon(dt) {
    this.deployTimer = Math.min(this.deployDuration, this.deployTimer + dt);

    const recoilReset = Math.max(0.34, (60 / this.weapon.rpm) * 1.6);
    if (this.time - this.lastShotAt > recoilReset) {
      this.shotIndex = 0;
    }

    this.bloom = Math.max(0, this.bloom - dt * (0.055 + this.bloom * 3.5));

    if (!this.triggerDown || !this.controls.isLocked) {
      if (!this.triggerDown) this.semiLatch = false;
      return;
    }

    if (this.time < this.nextFireAt || this.deployTimer < this.deployDuration * 0.72) {
      return;
    }

    if (this.reloading) return;

    if (!this.weapon.automatic && this.semiLatch) return;

    if (this.ammoState.clip <= 0) {
      this.semiLatch = true;
      if (this.time - this.lastEmptyAt > 0.25) {
        this.lastEmptyAt = this.time;
        this.audio?.playEmpty();
        this.callbacks.onEmpty?.();
      }
      return;
    }

    this.fire();
  }

  getSpread() {
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const speedRatio = clamp(speed / this.maxSpeed, 0, 1.35);
    let spread = this.weapon.baseSpread;
    spread += this.weapon.moveSpread * speedRatio;
    if (!this.grounded) spread += this.weapon.airSpread;
    if (this.keys.crouch && this.grounded) spread *= this.weapon.crouchMultiplier;
    if (this.scoped) spread *= 0.32;
    spread += this.bloom;
    return spread;
  }

  getCrosshairGap() {
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const speedPixels = clamp(speed / this.maxSpeed, 0, 1.35) * 2.2;
    return clamp(4 + this.getSpread() * 235 + speedPixels, 4, 34);
  }

  fire() {
    const weapon = this.weapon;
    const state = this.ammoState;

    state.clip -= 1;
    this.nextFireAt = this.time + 60 / weapon.rpm;
    this.lastShotAt = this.time;
    this.semiLatch = true;

    this.applyRecoil();
    this.bloom = Math.min(weapon.maxBloom, this.bloom + weapon.bloomPerShot);
    this.viewKick = Math.min(1.35, this.viewKick + 0.92);
    this.addTrauma(0.045);

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    const spread = this.getSpread();
    const jitter = randomDisk();
    const spreadTan = Math.tan(spread);
    const right = new THREE.Vector3().crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    direction
      .addScaledVector(right, jitter.x * spreadTan)
      .addScaledVector(up, jitter.y * spreadTan)
      .normalize();

    this.playMuzzleFlash();
    this.audio?.playPlayerShot(weapon.id);

    this.callbacks.onFire?.({
      origin,
      direction,
      weapon,
      spread,
    });

    this.emitAmmo();

    if (state.clip <= 0 && state.reserve > 0) {
      this.callbacks.onReloadState?.(false, false);
    }
  }

  applyRecoil() {
    const pattern = this.weapon.recoilPattern;
    const index = Math.min(this.shotIndex, pattern.length - 1);
    const previous = pattern[Math.max(0, index - 1)];
    const current = pattern[index];

    let horizontal = current[0] - previous[0];
    let vertical = current[1] - previous[1];

    horizontal += (Math.random() - 0.5) * this.weapon.recoilRandom;
    vertical *= 0.92 + Math.random() * 0.16;

    const pitch = THREE.MathUtils.degToRad(vertical);
    const yaw = THREE.MathUtils.degToRad(horizontal);

    this.camera.rotation.x = clamp(this.camera.rotation.x + pitch, -MAX_PITCH, MAX_PITCH);
    this.camera.rotation.y += yaw;

    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.shotIndex += 1;
  }

  updateRecoilRecovery(dt) {
    if (this.time - this.lastShotAt < 0.125) return;

    if (Math.abs(this.recoilPitch) > 0.00001) {
      const recover = Math.min(
        Math.abs(this.recoilPitch),
        (0.35 + Math.abs(this.recoilPitch) * 1.8) * dt,
      ) * Math.sign(this.recoilPitch);
      this.camera.rotation.x = clamp(this.camera.rotation.x - recover, -MAX_PITCH, MAX_PITCH);
      this.recoilPitch -= recover;
    }

    if (Math.abs(this.recoilYaw) > 0.00001) {
      const recover = Math.min(Math.abs(this.recoilYaw), 0.6 * dt) * Math.sign(this.recoilYaw);
      this.camera.rotation.y -= recover;
      this.recoilYaw -= recover;
    }
  }

  playMuzzleFlash() {
    const model = this.weaponModels[this.currentWeaponId];
    const flash = model?.userData.flash;
    if (!flash) return;

    flash.visible = true;
    flash.rotation.z = Math.random() * TAU;
    flash.rotation.x = Math.random() * 0.6;
    const scale = 0.75 + Math.random() * 0.7;
    flash.scale.setScalar(scale);
    this.muzzleTimer = 0.045;
  }

  updateMuzzleTimer(dt) {
    if (this.muzzleTimer <= 0) return;
    this.muzzleTimer -= dt;
    if (this.muzzleTimer <= 0) {
      const model = this.weaponModels[this.currentWeaponId];
      if (model) model.userData.flash.visible = false;
    }
  }

  /* =======================================================
     Dano, morte e respawn
     ======================================================= */

  applyDamage(amount, part = 'chest', source = null) {
    if (!this.alive) return;
    if (this.spawnProtection > 0) return;

    let damage = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, damage * 0.6);
      this.armor -= absorbed;
      damage -= absorbed;
    }

    this.health = Math.max(0, this.health - damage);
    this.lastDamageAt = this.time;
    this.addTrauma(clamp(0.1 + damage * 0.0035, 0.1, 0.32));
    this.audio?.playPlayerHurt();
    this.emitHealth();
    this.callbacks.onDamage?.({
      amount: damage,
      part,
      source,
      health: this.health,
      armor: this.armor,
    });

    if (this.health <= 0) {
      this.die(part, source);
    }
  }

  die(part, source) {
    if (!this.alive) return;
    this.alive = false;
    this.triggerDown = false;
    this.semiLatch = false;
    this.reloading = false;
    this.spawnProtection = 0;
    this.setScoped(false);
    this.body.velocity.set(0, this.body.velocity.y, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.weaponModels[this.currentWeaponId].visible = false;
    this.callbacks.onDeath?.({ part, source });
  }

  respawn(spawn) {
    this.spawnPoint = { ...spawn };
    this.alive = true;
    this.health = 100;
    this.armor = 100;
    this.reloading = false;
    this.reloadElapsed = 0;
    this.shotIndex = 0;
    this.bloom = 0;
    this.deployTimer = this.deployDuration;
    this.nextFireAt = this.time + this.deployDuration;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.trauma = 0;
    this.landDip = 0;
    this.fallVelocity = 0;
    this.wasGrounded = false;
    this.grounded = false;
    this.triggerDown = false;
    this.semiLatch = false;
    this.keys.crouch = false;
    this.spawnProtection = this.spawnProtectionDuration;

    this.scoped = false;
    this.scopeProgress = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();

    this.body.position.set(spawn.x, 0.46, spawn.z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.wakeUp();

    this.camera.rotation.set(0, spawn.yaw ?? 0, 0);
    this.camera.rotation.order = 'YXZ';

    this.ammo = {};
    for (const [id, weapon] of Object.entries(WEAPONS)) {
      this.ammo[id] = { clip: weapon.magazine, reserve: weapon.reserve };
    }
    if (!WEAPONS[this.currentWeaponId]) this.currentWeaponId = 'ak47';
    this.updateWeaponVisibility();
    this.setCameraFromPhysics(0, true);

    this.emitHealth();
    this.emitAmmo();
    this.callbacks.onWeaponChanged?.(this.weapon);
    this.callbacks.onReloadState?.(false, false);
    this.callbacks.onScopeChanged?.(false);
    this.callbacks.onRespawn?.();
  }

  /* =======================================================
     Câmera, viewmodel e efeitos visuais
     ======================================================= */

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  setCameraFromPhysics(dt, immediate = false) {
    const body = this.body.position;
    this.eyeOffset = immediate
      ? this.targetEyeOffset
      : damp(this.eyeOffset, this.targetEyeOffset, 14, dt);

    if (this.alive) {
      const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
      const speedRatio = clamp(speed / this.maxSpeed, 0, 1.2);
      const groundedBob = this.grounded ? 1 : 0.25;

      this.bobPhase += dt * (3.5 + speedRatio * 9.2) * (groundedBob > 0.5 ? 1 : 0.6);
      const bobX = Math.sin(this.bobPhase) * 0.012 * speedRatio * groundedBob;
      const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.017 * speedRatio * groundedBob;

      this.landDip = damp(this.landDip, 0, 10, dt);

      const yaw = this.camera.rotation.y;
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);

      const shake = this.trauma * this.trauma;
      const shakeX = (Math.random() - 0.5) * 0.022 * shake;
      const shakeY = (Math.random() - 0.5) * 0.018 * shake;

      this.camera.position.set(
        body.x + rightX * bobX + shakeX,
        body.y + this.eyeOffset + bobY - this.landDip + shakeY,
        body.z + rightZ * bobX + shakeX * 0.4,
      );

      this.trauma = Math.max(0, this.trauma - dt * 2.6);
      this.updateFootsteps(dt, speed, speedRatio);
    } else {
      this.camera.position.set(body.x, body.y + 0.66, body.z);
    }

    this.updateScope(dt);
    this.updateWeaponModel(dt);
    this.updateRecoilRecovery(dt);
  }

  updateScope(dt) {
    const target = this.scoped ? 1 : 0;
    this.scopeProgress = damp(this.scopeProgress, target, 13, dt);
    const fov = lerp(this.baseFov, this.scopeFov, this.scopeProgress);

    if (Math.abs(this.camera.fov - fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateFootsteps(dt, speed, speedRatio) {
    if (!this.grounded || speed < 0.35) {
      this.footstepDistance = Math.min(this.footstepDistance, 1.5);
      return;
    }

    this.footstepDistance += speed * dt;
    const threshold = this.keys.walk ? 2.35 : this.keys.crouch ? 2.7 : 1.85 + (1 - speedRatio) * 0.4;

    if (this.footstepDistance >= threshold) {
      this.footstepDistance = 0;
      const volume = this.keys.walk || this.keys.crouch ? 0.22 : 0.42;
      this.audio?.playFootstep(volume);
    }
  }

  updateWeaponModel(dt) {
    const model = this.weaponModels[this.currentWeaponId];
    if (!model || !this.alive) return;

    const basePos = model.userData.basePosition;
    const baseRot = model.userData.baseRotation;
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const speedRatio = clamp(speed / this.maxSpeed, 0, 1.2);

    this.viewKick = damp(this.viewKick, 0, 15, dt);

    const swayTargetX = clamp(-this.body.velocity.x * 0.008, -0.035, 0.035);
    const swayTargetY = clamp(this.body.velocity.z * 0.005, -0.02, 0.02);
    this.viewSwayX = damp(this.viewSwayX, swayTargetX, 7, dt);
    this.viewSwayY = damp(this.viewSwayY, swayTargetY, 7, dt);

    const bobX = Math.sin(this.bobPhase) * 0.012 * speedRatio * (this.grounded ? 1 : 0.2);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * speedRatio * (this.grounded ? 1 : 0.2);

    let reloadDrop = 0;
    let reloadTilt = 0;
    if (this.reloading) {
      const progress = clamp(this.reloadElapsed / this.weapon.reloadTime, 0, 1);
      const curve = Math.sin(progress * Math.PI);
      reloadDrop = curve * 0.17;
      reloadTilt = curve * 0.72;
    }

    let deployOffset = 0;
    if (this.deployTimer < this.deployDuration) {
      const progress = this.deployTimer / this.deployDuration;
      deployOffset = (1 - progress) * 0.25;
    }

    model.position.set(
      basePos.x + bobX + this.viewSwayX,
      basePos.y + bobY + this.viewSwayY - reloadDrop - deployOffset,
      basePos.z + this.viewKick * 0.07,
    );
    model.rotation.set(
      baseRot.x + this.viewKick * 0.085 + reloadTilt + deployOffset * 1.4,
      baseRot.y,
      baseRot.z + Math.sin(this.bobPhase) * 0.008 * speedRatio,
    );
  }

  updateVisual(dt) {
    this.setCameraFromPhysics(dt);
  }

  getAimPoint(target = new THREE.Vector3()) {
    target.set(
      this.body.position.x,
      this.body.position.y + 0.45,
      this.body.position.z,
    );
    return target;
  }

  getHeadPoint(target = new THREE.Vector3()) {
    target.set(
      this.body.position.x,
      this.body.position.y + 1.08,
      this.body.position.z,
    );
    return target;
  }

  getFeetPoint(target = new THREE.Vector3()) {
    target.set(this.body.position.x, this.body.position.y - 0.4, this.body.position.z);
    return target;
  }

  emitHealth() {
    this.callbacks.onHealthChanged?.(this.health, this.armor);
  }

  emitAmmo() {
    const state = this.ammoState;
    this.callbacks.onAmmoChanged?.({
      weapon: this.weapon,
      clip: state.clip,
      reserve: state.reserve,
      reloading: this.reloading,
    });
  }
}
