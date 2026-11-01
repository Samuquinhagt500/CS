import * as THREE from 'three';

const TAU = Math.PI * 2;
const BOT_RADIUS = 0.37;
const BOT_EYE_HEIGHT = 1.62;
const BOT_RESPAWN_DELAY = 3.4;

const BOT_NAMES = [
  'Vitaliy', 'Dmitri', 'Ivan', 'Sergei', 'Pavel',
  'Yuri', 'Nikolai', 'Andrei', 'Boris', 'Oleg',
];

const SHIRT_COLORS = [0x76563a, 0x5d4937, 0x6c4c31, 0x4f4539, 0x806242];
const PANTS_COLORS = [0x302d27, 0x3a342b, 0x25241f, 0x413b31];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, speed, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function randomDisk() {
  const angle = Math.random() * TAU;
  const radius = Math.sqrt(Math.random());
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/* =========================================================
   Navegação em grade + A*
   ========================================================= */

class NavGrid {
  constructor({ minX, maxX, minZ, maxZ, cellSize = 1.25, colliders = [] }) {
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.cellSize = cellSize;
    this.colliders = colliders;
    this.cols = Math.ceil((maxX - minX) / cellSize);
    this.rows = Math.ceil((maxZ - minZ) / cellSize);
    this.walkable = new Uint8Array(this.cols * this.rows);
    this.build();
  }

  build() {
    for (let cz = 0; cz < this.rows; cz += 1) {
      for (let cx = 0; cx < this.cols; cx += 1) {
        const { x, z } = this.cellToWorld(cx, cz);
        this.walkable[cz * this.cols + cx] = this.isPointFree(x, z) ? 1 : 0;
      }
    }
  }

  isPointFree(x, z, padding = BOT_RADIUS + 0.1) {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) {
      return false;
    }

    for (const box of this.colliders) {
      if (
        x > box.minX - padding
        && x < box.maxX + padding
        && z > box.minZ - padding
        && z < box.maxZ + padding
      ) {
        return false;
      }
    }

    return true;
  }

  worldToCell(x, z) {
    return {
      cx: clamp(Math.floor((x - this.minX) / this.cellSize), 0, this.cols - 1),
      cz: clamp(Math.floor((z - this.minZ) / this.cellSize), 0, this.rows - 1),
    };
  }

  cellToWorld(cx, cz) {
    return {
      x: this.minX + (cx + 0.5) * this.cellSize,
      z: this.minZ + (cz + 0.5) * this.cellSize,
    };
  }

  isWalkable(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
    return this.walkable[cz * this.cols + cx] === 1;
  }

  nearestWalkable(x, z, maxRadius = 14) {
    const origin = this.worldToCell(x, z);
    if (this.isWalkable(origin.cx, origin.cz)) return origin;

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      let best = null;
      let bestDist = Infinity;

      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          const cx = origin.cx + dx;
          const cz = origin.cz + dz;
          if (!this.isWalkable(cx, cz)) continue;

          const world = this.cellToWorld(cx, cz);
          const dist = (world.x - x) ** 2 + (world.z - z) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = { cx, cz };
          }
        }
      }

      if (best) return best;
    }

    return null;
  }

  findPath(startX, startZ, goalX, goalZ) {
    const start = this.nearestWalkable(startX, startZ);
    const goal = this.nearestWalkable(goalX, goalZ);
    if (!start || !goal) return null;

    const startIndex = start.cz * this.cols + start.cx;
    const goalIndex = goal.cz * this.cols + goal.cx;
    if (startIndex === goalIndex) {
      const point = this.cellToWorld(goal.cx, goal.cz);
      return [new THREE.Vector3(point.x, 0, point.z)];
    }

    const total = this.cols * this.rows;
    const gScore = new Float32Array(total);
    const fScore = new Float32Array(total);
    const cameFrom = new Int32Array(total);
    const closed = new Uint8Array(total);
    const inOpen = new Uint8Array(total);

    gScore.fill(Infinity);
    fScore.fill(Infinity);
    cameFrom.fill(-1);

    const heuristic = (a, b) => {
      const ax = a % this.cols;
      const az = Math.floor(a / this.cols);
      const bx = b % this.cols;
      const bz = Math.floor(b / this.cols);
      const dx = Math.abs(ax - bx);
      const dz = Math.abs(az - bz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(startIndex, goalIndex);
    const open = [startIndex];
    inOpen[startIndex] = 1;

    const neighbors = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];

    let iterations = 0;
    while (open.length > 0 && iterations < total * 2.5) {
      iterations += 1;

      let bestOpenIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (fScore[open[i]] < fScore[open[bestOpenIndex]]) bestOpenIndex = i;
      }

      const current = open.splice(bestOpenIndex, 1)[0];
      inOpen[current] = 0;

      if (current === goalIndex) {
        return this.reconstructPath(cameFrom, current);
      }

      closed[current] = 1;
      const cx = current % this.cols;
      const cz = Math.floor(current / this.cols);

      for (const [dx, dz, cost] of neighbors) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.isWalkable(nx, nz)) continue;

        // Impede cortar cantos na diagonal.
        if (dx !== 0 && dz !== 0) {
          if (!this.isWalkable(cx + dx, cz) || !this.isWalkable(cx, cz + dz)) continue;
        }

        const neighbor = nz * this.cols + nx;
        if (closed[neighbor]) continue;

        const tentative = gScore[current] + cost;
        if (tentative >= gScore[neighbor]) continue;

        cameFrom[neighbor] = current;
        gScore[neighbor] = tentative;
        fScore[neighbor] = tentative + heuristic(neighbor, goalIndex);

        if (!inOpen[neighbor]) {
          open.push(neighbor);
          inOpen[neighbor] = 1;
        }
      }
    }

    return null;
  }

  reconstructPath(cameFrom, current) {
    const cells = [];
    while (current !== -1) {
      cells.push(current);
      current = cameFrom[current];
    }
    cells.reverse();

    const points = cells.map((index) => {
      const cx = index % this.cols;
      const cz = Math.floor(index / this.cols);
      const world = this.cellToWorld(cx, cz);
      return new THREE.Vector3(world.x, 0, world.z);
    });

    return this.smoothPath(points);
  }

  smoothPath(points) {
    if (points.length <= 2) return points;

    const result = [points[0]];
    let anchor = 0;

    while (anchor < points.length - 1) {
      let furthest = anchor + 1;
      for (let i = points.length - 1; i > anchor + 1; i -= 1) {
        if (this.lineWalkable(points[anchor], points[i])) {
          furthest = i;
          break;
        }
      }
      result.push(points[furthest]);
      anchor = furthest;
    }

    return result;
  }

  lineWalkable(a, b, padding = BOT_RADIUS + 0.08) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / (this.cellSize * 0.4)));

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!this.isPointFree(a.x + dx * t, a.z + dz * t, padding)) return false;
    }

    return true;
  }
}

/* =========================================================
   Bot individual
   ========================================================= */

class Bot {
  constructor({ manager, id, name, spawn, skill }) {
    this.manager = manager;
    this.id = id;
    this.name = name;
    this.spawn = { ...spawn };
    this.skill = skill;

    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.velocity = new THREE.Vector3();
    this.desiredVelocity = new THREE.Vector3();
    this.yaw = spawn.yaw ?? Math.random() * TAU;
    this.targetYaw = this.yaw;
    this.radius = BOT_RADIUS;

    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.state = 'patrol';
    this.time = Math.random() * 10;
    this.deathTimer = 0;
    this.respawnTimer = 0;
    this.rootVisible = true;

    this.path = [];
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.destination = null;
    this.repathCooldown = 0;

    this.lastSeen = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.lastSeenTime = 99;
    this.wasSeeing = false;
    this.alerted = false;
    this.reactionTimer = 0;
    this.burstRemaining = 0;
    this.burstCooldown = 0.5 + Math.random();
    this.shotTimer = 0;
    this.lastShotAt = -99;
    this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.stuckTimer = 0;
    this.previousPosition = this.position.clone();
    this.muzzleTimer = 0;
    this.flashSeed = Math.random() * 10;

    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.hitMeshes = [];
    this.buildModel();
    this.manager.scene.add(this.root);

    this.deathFall = 0;
    this.lastPart = 'chest';
  }

  /* ---------------- modelo low-poly ---------------- */

  buildModel() {
    const skin = new THREE.MeshStandardMaterial({
      color: 0x9f7558,
      roughness: 0.95,
    });
    const shirt = new THREE.MeshStandardMaterial({
      color: SHIRT_COLORS[this.id % SHIRT_COLORS.length],
      roughness: 0.94,
    });
    const pants = new THREE.MeshStandardMaterial({
      color: PANTS_COLORS[this.id % PANTS_COLORS.length],
      roughness: 0.97,
    });
    const vest = new THREE.MeshStandardMaterial({
      color: 0x2d2b26,
      roughness: 0.86,
      metalness: 0.08,
    });
    const mask = new THREE.MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.98,
    });
    const boot = new THREE.MeshStandardMaterial({
      color: 0x171613,
      roughness: 0.9,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x23231f,
      metalness: 0.62,
      roughness: 0.5,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: 0x6a3c1f,
      roughness: 0.88,
    });

    const addPart = (mesh, part, parent = this.root) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.bot = this;
      mesh.userData.part = part;
      parent.add(mesh);
      this.hitMeshes.push(mesh);
      return mesh;
    };

    // Pernas.
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.74, 0.22), pants);
    leftLeg.position.set(-0.14, 0.43, 0);
    addPart(leftLeg, 'leg');

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.74, 0.22), pants);
    rightLeg.position.set(0.14, 0.43, 0);
    addPart(rightLeg, 'leg');

    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.29), boot);
    leftBoot.position.set(-0.14, 0.09, 0.035);
    addPart(leftBoot, 'leg');

    const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.29), boot);
    rightBoot.position.set(0.14, 0.09, 0.035);
    addPart(rightBoot, 'leg');

    // Tronco.
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.66, 0.31), shirt);
    torso.position.set(0, 1.14, 0);
    addPart(torso, 'chest');

    const tacticalVest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.37), vest);
    tacticalVest.position.set(0, 1.2, 0);
    addPart(tacticalVest, 'chest');

    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.33), boot);
    belt.position.set(0, 0.82, 0);
    addPart(belt, 'chest');

    // Cabeça, gorro e balaclava.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 8), skin);
    head.position.set(0, 1.67, 0);
    addPart(head, 'head');

    const balaclava = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.2, 0.28), mask);
    balaclava.position.set(0, 1.59, 0.015);
    addPart(balaclava, 'head');

    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 5, 0, TAU, 0, Math.PI * 0.55), mask);
    beanie.position.set(0, 1.71, 0);
    addPart(beanie, 'head');

    // Braços.
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.52, 0.17), shirt);
    leftArm.position.set(-0.37, 1.13, 0.07);
    leftArm.rotation.x = -0.25;
    leftArm.rotation.z = -0.1;
    addPart(leftArm, 'arm');

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.52, 0.17), shirt);
    rightArm.position.set(0.37, 1.15, 0.1);
    rightArm.rotation.x = -0.36;
    rightArm.rotation.z = 0.12;
    addPart(rightArm, 'arm');

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.16), skin);
    leftHand.position.set(-0.3, 1.02, 0.36);
    addPart(leftHand, 'arm');

    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.16), skin);
    rightHand.position.set(0.21, 1.08, 0.37);
    addPart(rightHand, 'arm');

    // AK simplificada apontando para +Z (frente do modelo).
    const gunGroup = new THREE.Group();
    gunGroup.position.set(0.2, 1.17, 0.27);

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.4), steel);
    receiver.position.z = 0.08;
    gunGroup.add(receiver);

    const gunWood = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.28), wood);
    gunWood.position.set(0, 0.01, 0.32);
    gunGroup.add(gunWood);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.38, 7), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, 0.4);
    gunGroup.add(barrel);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), steel);
    mag.position.set(0, -0.14, 0.03);
    mag.rotation.x = -0.15;
    gunGroup.add(mag);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.025, 0.62);
    gunGroup.add(muzzle);

    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc26a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 6), flashMaterial);
    this.muzzleFlash.visible = false;
    muzzle.add(this.muzzleFlash);

    this.muzzleNode = muzzle;
    gunGroup.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.root.add(gunGroup);

    // Pequena faixa vermelha de identificação da facção.
    const armband = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.07, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x8b2c23, roughness: 0.9 }),
    );
    armband.position.set(-0.37, 1.17, 0.075);
    this.root.add(armband);

    // Sombra circular para assentar o boneco no chão.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 14),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.root.add(shadow);
    this.groundShadow = shadow;
  }

  /* ---------------- vida / morte ---------------- */

  takeDamage(baseDamage, part = 'chest', hitPoint = null, sourcePosition = null, weaponName = 'AK-47') {
    if (!this.alive) return { killed: false, damage: 0, part };

    const multipliers = {
      head: 4,
      chest: 1,
      stomach: 1.1,
      arm: 0.72,
      leg: 0.68,
    };
    const multiplier = multipliers[part] ?? 1;
    const damage = baseDamage * multiplier;

    this.health = Math.max(0, this.health - damage);
    this.lastPart = part;

    if (sourcePosition) {
      this.lastSeen.copy(sourcePosition);
      this.lastSeen.y = 0;
      this.lastSeenTime = 0;
      this.state = 'search';
      this.alerted = true;
      this.reactionTimer = Math.min(this.reactionTimer, 0.25);
      this.burstCooldown = Math.min(this.burstCooldown, 0.2);
    }

    if (this.health <= 0) {
      this.die(hitPoint, part, weaponName);
      return { killed: true, damage, part };
    }

    return { killed: false, damage, part };
  }

  die(hitPoint = null, part = 'chest', weaponName = 'AK-47') {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.velocity.set(0, 0, 0);
    this.deathTimer = 0;
    this.deathFall = (Math.random() > 0.5 ? -1 : 1) * (1.15 + Math.random() * 0.5);
    this.muzzleFlash.visible = false;
    this.lastPart = part;
    this.lastWeapon = weaponName;

    // Derruba o modelo para o lado; não é ragdoll, mas dá leitura clara.
    this.root.rotation.z = 0;
    this.groundShadow.visible = false;
  }

  updateDead(dt) {
    this.deathTimer += dt;

    if (this.deathTimer < 2.2) {
      const t = clamp(this.deathTimer / 0.55, 0, 1);
      const eased = 1 - (1 - t) ** 3;
      this.root.rotation.z = this.deathFall * eased;
      this.root.position.y = -0.04 * eased;
    } else {
      this.root.visible = false;
    }
  }

  respawn(spawn) {
    this.spawn = { ...spawn };
    this.position.set(spawn.x, 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.desiredVelocity.set(0, 0, 0);
    this.yaw = spawn.yaw ?? Math.random() * TAU;
    this.targetYaw = this.yaw;
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.yaw, 0);
    this.root.visible = true;
    this.groundShadow.visible = true;
    this.health = 100;
    this.alive = true;
    this.state = 'patrol';
    this.deathTimer = 0;
    this.respawnTimer = 0;
    this.path = [];
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.repathCooldown = 0;
    this.destination = null;
    this.lastSeenTime = 99;
    this.wasSeeing = false;
    this.alerted = false;
    this.reactionTimer = 0;
    this.burstRemaining = 0;
    this.burstCooldown = 0.7 + Math.random();
    this.shotTimer = 0;
    this.stuckTimer = 0;
    this.previousPosition.copy(this.position);
    this.muzzleFlash.visible = false;
  }

  /* ---------------- percepção / IA ---------------- */

  update(dt, player) {
    if (!this.alive) {
      this.updateDead(dt);
      return;
    }

    this.time += dt;
    this.deathTimer = 0;
    this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
    this.muzzleFlash.visible = this.muzzleTimer > 0;
    this.lastSeenTime += dt;
    this.shotTimer -= dt;
    this.burstCooldown -= dt;
    this.strafeTimer -= dt;
    this.repathCooldown -= dt;

    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.7 + Math.random() * 1.15;
      if (Math.random() > 0.68) this.strafeDirection *= -1;
    }

    const seesPlayer = this.canSeePlayer(player, dt);
    if (seesPlayer) {
      this.lastSeen.set(player.body.position.x, 0, player.body.position.z);
      this.lastSeenTime = 0;

      if (this.state !== 'attack') {
        this.reactionTimer = 0.24 + (1 - this.skill) * 0.52 + Math.random() * 0.18;
        this.state = 'attack';
        this.burstCooldown = Math.max(this.burstCooldown, 0.12);
      }

      this.wasSeeing = true;
      this.updateAttack(dt, player);
    } else {
      if (this.wasSeeing) {
        this.state = 'search';
        this.wasSeeing = false;
      }

      if (this.state === 'attack') {
        this.state = 'search';
      }

      if (this.state === 'search') {
        if (this.lastSeenTime > 8.5) {
          this.state = 'patrol';
          this.path = [];
          this.destination = null;
          this.alerted = false;
        } else {
          this.updateSearch(dt);
        }
      }

      if (this.state === 'patrol') {
        this.updatePatrol(dt);
      }
    }

    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.updateMovement(dt);
    this.resolveCollisions();
    this.updateStuck(dt);

    const bob = this.alive
      ? Math.sin(this.time * 9 + this.flashSeed) * 0.012 * clamp(this.velocity.length() / 3, 0, 1)
      : 0;
    this.root.position.set(this.position.x, bob, this.position.z);
    this.root.rotation.y = this.yaw;
  }

  canSeePlayer(player, dt) {
    if (!player.alive) return false;
    // Durante a proteção de spawn os bots não adquirem o jogador.
    if (player.spawnProtection > 0) return false;

    const dx = player.body.position.x - this.position.x;
    const dz = player.body.position.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 47) return false;

    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const directionX = dx / Math.max(distance, 0.001);
    const directionZ = dz / Math.max(distance, 0.001);
    const dot = forwardX * directionX + forwardZ * directionZ;

    // Visão periférica; inimigos muito próximos são percebidos de qualquer lado.
    if (dot < Math.cos(THREE.MathUtils.degToRad(74)) && distance > 4.2 && !this.alerted) {
      return false;
    }

    const eye = new THREE.Vector3(this.position.x, BOT_EYE_HEIGHT, this.position.z);
    const target = player.getAimPoint(new THREE.Vector3());
    target.y += 0.45;

    return this.manager.hasLineOfSight(eye, target);
  }

  updateAttack(dt, player) {
    const dx = player.body.position.x - this.position.x;
    const dz = player.body.position.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    this.targetYaw = targetYaw;

    // Strafe curto para não virar um alvo estático.
    const strafeX = Math.cos(targetYaw) * this.strafeDirection;
    const strafeZ = -Math.sin(targetYaw) * this.strafeDirection;
    let moveX = 0;
    let moveZ = 0;

    if (distance > 16) {
      const path = this.ensurePath(player.body.position.x, player.body.position.z, 0.9);
      if (path) {
        this.followPath(3.55, dt);
        this.tryShoot(player, distance);
        return;
      }
      moveX = dx / distance;
      moveZ = dz / distance;
    } else if (distance < 5.2) {
      moveX = -dx / distance + strafeX * 0.65;
      moveZ = -dz / distance + strafeZ * 0.65;
    } else {
      moveX = strafeX;
      moveZ = strafeZ;
    }

    this.applyDesiredDirection(moveX, moveZ, 2.75);
    this.tryShoot(player, distance);
  }

  updateSearch(dt) {
    const path = this.ensurePath(this.lastSeen.x, this.lastSeen.z, 1.2);
    if (path) {
      this.followPath(3.0, dt);
    } else {
      this.applyDesiredDirection(0, 0, 0);
    }

    if (this.lastSeenTime < 6) {
      const scan = Math.sin(this.time * 2.2) * 0.65;
      this.targetYaw = Math.atan2(
        this.lastSeen.x - this.position.x,
        this.lastSeen.z - this.position.z,
      ) + scan;
    }
  }

  updatePatrol(dt) {
    if (!this.destination || this.path.length === 0 || this.pathIndex >= this.path.length) {
      const points = this.manager.patrolPoints;
      let target = points[Math.floor(Math.random() * points.length)];
      if (this.destination) {
        // Evita escolher o mesmo canto repetidamente.
        for (let i = 0; i < 5; i += 1) {
          const candidate = points[Math.floor(Math.random() * points.length)];
          const currentDist = Math.hypot(
            candidate.x - this.destination.x,
            candidate.z - this.destination.z,
          );
          if (currentDist > 6) {
            target = candidate;
            break;
          }
        }
      }

      const path = this.ensurePath(target.x, target.z, 1.2);
      if (!path) {
        this.applyDesiredDirection(0, 0, 0);
        this.repathCooldown = 1.2;
        return;
      }
    }

    if (this.path.length > 0) {
      this.followPath(2.45 + this.skill * 0.55, dt);
      const look = Math.sin(this.time * 0.8 + this.flashSeed) * 0.3;
      const velocityLook = this.velocity.lengthSq() > 0.1
        ? Math.atan2(this.velocity.x, this.velocity.z)
        : this.targetYaw;
      this.targetYaw = velocityLook + look;
    } else {
      this.applyDesiredDirection(0, 0, 0);
    }
  }

  /* ---------------- caminho / movimento ---------------- */

  ensurePath(x, z, forceDistance = 1.6) {
    if (this.repathCooldown > 0 && this.path.length > 0) {
      return this.path;
    }

    const changed = !this.destination
      || Math.hypot(this.destination.x - x, this.destination.z - z) > forceDistance;

    if (!changed && this.path.length > 0) return this.path;

    const path = this.manager.navGrid.findPath(this.position.x, this.position.z, x, z);
    this.repathCooldown = 0.55 + Math.random() * 0.35;

    if (!path || path.length === 0) {
      this.path = [];
      this.pathIndex = 0;
      return null;
    }

    this.destination = new THREE.Vector3(x, 0, z);
    this.path = path;
    this.pathIndex = path.length > 1 ? 1 : 0;
    return this.path;
  }

  followPath(speed, dt) {
    if (!this.path || this.pathIndex >= this.path.length) {
      this.applyDesiredDirection(0, 0, 0);
      return;
    }

    const target = this.path[this.pathIndex];
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.58) {
      this.pathIndex += 1;
      if (this.pathIndex >= this.path.length) {
        this.path = [];
        this.pathIndex = 0;
        this.applyDesiredDirection(0, 0, 0);
        return;
      }
    }

    const next = this.path[Math.min(this.pathIndex, this.path.length - 1)];
    const nx = next.x - this.position.x;
    const nz = next.z - this.position.z;
    const length = Math.hypot(nx, nz) || 1;
    this.applyDesiredDirection(nx / length, nz / length, speed);
  }

  applyDesiredDirection(x, z, speed) {
    const length = Math.hypot(x, z);
    if (length < 0.001) {
      this.desiredVelocity.set(0, 0, 0);
      return;
    }

    this.desiredVelocity.set((x / length) * speed, 0, (z / length) * speed);
    if (this.state !== 'attack') {
      this.targetYaw = Math.atan2(x, z);
    }
  }

  updateMovement(dt) {
    const acceleration = this.state === 'attack' ? 11 : 8;
    this.velocity.x = damp(this.velocity.x, this.desiredVelocity.x, acceleration, dt);
    this.velocity.z = damp(this.velocity.z, this.desiredVelocity.z, acceleration, dt);

    if (this.velocity.lengthSq() < 0.0004) {
      this.velocity.set(0, 0, 0);
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const turnSpeed = this.state === 'attack' ? 10 : 7;
    const delta = shortestAngle(this.yaw, this.targetYaw);
    const maxTurn = turnSpeed * dt;
    this.yaw += clamp(delta, -maxTurn, maxTurn);
    this.yaw = ((this.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }

  resolveCollisions() {
    const boxes = this.manager.navGrid.colliders;
    const radius = this.radius;

    for (const box of boxes) {
      const closestX = clamp(this.position.x, box.minX, box.maxX);
      const closestZ = clamp(this.position.z, box.minZ, box.maxZ);
      let dx = this.position.x - closestX;
      let dz = this.position.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq >= radius * radius) continue;

      if (distSq > 0.0000001) {
        const distance = Math.sqrt(distSq);
        const push = radius - distance;
        this.position.x += (dx / distance) * push;
        this.position.z += (dz / distance) * push;
      } else {
        // Centro exatamente dentro da caixa: empurra pelo menor eixo.
        const left = Math.abs(this.position.x - box.minX);
        const right = Math.abs(box.maxX - this.position.x);
        const top = Math.abs(this.position.z - box.minZ);
        const bottom = Math.abs(box.maxZ - this.position.z);
        const min = Math.min(left, right, top, bottom);
        if (min === left) this.position.x = box.minX - radius;
        else if (min === right) this.position.x = box.maxX + radius;
        else if (min === top) this.position.z = box.minZ - radius;
        else this.position.z = box.maxZ + radius;
      }
    }

    const nav = this.manager.navGrid;
    this.position.x = clamp(this.position.x, nav.minX + radius, nav.maxX - radius);
    this.position.z = clamp(this.position.z, nav.minZ + radius, nav.maxZ - radius);
  }

  updateStuck(dt) {
    const moved = Math.hypot(
      this.position.x - this.previousPosition.x,
      this.position.z - this.previousPosition.z,
    );

    if (this.desiredVelocity.lengthSq() > 0.3 && moved < 0.028) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 1.8);
    }

    if (this.stuckTimer > 0.7) {
      this.stuckTimer = 0;
      this.repathCooldown = 0;
      this.path = [];
      this.destination = null;
      this.strafeDirection *= -1;
      this.position.x += (Math.random() - 0.5) * 0.22;
      this.position.z += (Math.random() - 0.5) * 0.22;
    }

    this.previousPosition.copy(this.position);
  }

  /* ---------------- combate ---------------- */

  tryShoot(player, distance) {
    if (this.reactionTimer > 0 || this.burstCooldown > 0) return;

    if (this.burstRemaining <= 0) {
      this.burstRemaining = 3 + Math.floor(Math.random() * 4);
    }

    if (this.burstRemaining <= 0 || this.shotTimer > 0) return;

    this.fireAtPlayer(player, distance);
    this.burstRemaining -= 1;
    this.shotTimer = 0.108 + Math.random() * 0.035;

    if (this.burstRemaining <= 0) {
      this.burstCooldown = 0.48 + Math.random() * 0.85;
    }
  }

  fireAtPlayer(player, distance) {
    const origin = this.getMuzzleWorldPosition(new THREE.Vector3());

    const feet = player.getFeetPoint(new THREE.Vector3());
    const target = new THREE.Vector3(
      feet.x + (Math.random() - 0.5) * 0.24,
      feet.y + 0.82 + Math.random() * 0.74,
      feet.z + (Math.random() - 0.5) * 0.24,
    );

    const direction = target.sub(origin).normalize();

    const playerSpeed = Math.hypot(player.body.velocity.x, player.body.velocity.z);
    const errorRad = clamp(
      (1 - this.skill) * 0.029
      + distance * 0.00062
      + playerSpeed * 0.0024
      + (player.grounded ? 0 : 0.008),
      0.004,
      0.06,
    );

    const jitter = randomDisk();
    const right = new THREE.Vector3().crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    const tanError = Math.tan(errorRad);
    direction
      .addScaledVector(right, jitter.x * tanError)
      .addScaledVector(up, jitter.y * tanError)
      .normalize();

    const wallHit = this.manager.raycastWorld(origin, direction, 90);
    const wallDistance = wallHit ? wallHit.distance : 90;

    const ray = new THREE.Ray(origin, direction);
    const bodySphere = new THREE.Sphere(
      new THREE.Vector3(
        player.body.position.x,
        player.body.position.y + 0.5,
        player.body.position.z,
      ),
      0.44,
    );
    const headSphere = new THREE.Sphere(
      new THREE.Vector3(
        player.body.position.x,
        player.body.position.y + 1.08,
        player.body.position.z,
      ),
      0.23,
    );
    const legSphere = new THREE.Sphere(
      new THREE.Vector3(
        player.body.position.x,
        player.body.position.y - 0.08,
        player.body.position.z,
      ),
      0.34,
    );

    const headPoint = ray.intersectSphere(headSphere, new THREE.Vector3());
    const bodyPoint = ray.intersectSphere(bodySphere, new THREE.Vector3());
    const legPoint = ray.intersectSphere(legSphere, new THREE.Vector3());

    const candidates = [];
    if (headPoint) candidates.push({ point: headPoint, part: 'head' });
    if (bodyPoint) candidates.push({ point: bodyPoint, part: 'chest' });
    if (legPoint) candidates.push({ point: legPoint, part: 'leg' });

    candidates.sort((a, b) => a.point.distanceTo(origin) - b.point.distanceTo(origin));

    let hit = null;
    if (candidates.length > 0 && candidates[0].point.distanceTo(origin) < wallDistance) {
      hit = candidates[0];
    }

    const end = hit
      ? hit.point.clone()
      : wallHit
        ? wallHit.point.clone()
        : origin.clone().addScaledVector(direction, 80);

    this.muzzleTimer = 0.052;
    this.lastShotAt = this.time;

    if (hit) {
      // Dano mais suave que o AK original: dá tempo de reagir e usar cobertura.
      const partMultiplier = hit.part === 'head' ? 1.3 : hit.part === 'leg' ? 0.7 : 1;
      const distanceFalloff = clamp(1 - Math.max(0, distance - 18) * 0.011, 0.62, 1);
      const damage = ((6 + this.skill * 3) + Math.random() * 2)
        * partMultiplier
        * distanceFalloff;
      // Passa o próprio bot como fonte para o kill feed e overlays.
      player.applyDamage(damage, hit.part, this);
    }

    this.manager.callbacks.onBotShot?.({
      origin: origin.clone(),
      end,
      hit: Boolean(hit),
      part: hit?.part ?? null,
      bot: this,
    });
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.muzzleNode.getWorldPosition(target);
    return target;
  }

  getPosition() {
    return this.position;
  }
}

/* =========================================================
   Gerenciador de bots
   ========================================================= */

export class BotManager {
  constructor({
    scene,
    player,
    world,
    map,
    callbacks = {},
  }) {
    this.scene = scene;
    this.player = player;
    this.world = world;
    this.callbacks = callbacks;
    this.occluders = map.occluders;
    this.botSpawns = map.botSpawns;
    this.patrolPoints = map.patrolPoints;

    this.navGrid = new NavGrid({
      minX: map.bounds.minX + 1.1,
      maxX: map.bounds.maxX - 1.1,
      minZ: map.bounds.minZ + 1.1,
      maxZ: map.bounds.maxZ - 1.1,
      cellSize: 1.25,
      colliders: map.colliders,
    });

    this.bots = [];
    this.raycaster = new THREE.Raycaster();
    this.tempDirection = new THREE.Vector3();
    this.tempTarget = new THREE.Vector3();
    this.nextId = 0;
  }

  setCount(count) {
    const desired = clamp(Math.floor(count), 0, 10);

    while (this.bots.length < desired) {
      const index = this.nextId;
      const name = BOT_NAMES[index % BOT_NAMES.length];
      const spawn = this.pickSpawn(this.player ? this.player.body.position : null);
      const skill = 0.36 + Math.random() * 0.29;
      const bot = new Bot({
        manager: this,
        id: index,
        name,
        spawn,
        skill,
      });
      this.bots.push(bot);
      this.nextId += 1;
    }

    while (this.bots.length > desired) {
      const bot = this.bots.pop();
      this.scene.remove(bot.root);
    }
  }

  reset() {
    for (const bot of this.bots) {
      const spawn = this.pickSpawn(this.player.body.position);
      bot.respawn(spawn);
    }
  }

  update(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.updateDead(dt);
        bot.respawnTimer += dt;
        if (bot.respawnTimer >= BOT_RESPAWN_DELAY) {
          const spawn = this.pickSpawn(this.player.body.position);
          bot.respawn(spawn);
        }
        continue;
      }

      bot.update(dt, this.player);
    }

    this.separateBots();
  }

  separateBots() {
    const minDistance = 0.78;

    for (let i = 0; i < this.bots.length; i += 1) {
      const a = this.bots[i];
      if (!a.alive) continue;

      for (let j = i + 1; j < this.bots.length; j += 1) {
        const b = this.bots[j];
        if (!b.alive) continue;

        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let distance = Math.hypot(dx, dz);
        if (distance >= minDistance || distance < 0.0001) continue;

        const push = (minDistance - distance) * 0.5;
        dx /= distance;
        dz /= distance;
        a.position.x -= dx * push;
        a.position.z -= dz * push;
        b.position.x += dx * push;
        b.position.z += dz * push;

        a.resolveCollisions();
        b.resolveCollisions();
        distance = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
      }
    }
  }

  pickSpawn(playerPosition) {
    const candidates = this.botSpawns;
    let best = candidates[0];
    let bestScore = -Infinity;

    for (let i = 0; i < 10; i += 1) {
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];
      const playerDistance = playerPosition
        ? Math.hypot(candidate.x - playerPosition.x, candidate.z - playerPosition.z)
        : 30;

      let nearestBot = 30;
      for (const bot of this.bots) {
        if (!bot.alive) continue;
        const distance = Math.hypot(candidate.x - bot.position.x, candidate.z - bot.position.z);
        nearestBot = Math.min(nearestBot, distance);
      }

      const score = playerDistance * 0.7 + Math.min(nearestBot, 8) * 2.2 + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  alert(position, radius = 22) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const distance = Math.hypot(
        bot.position.x - position.x,
        bot.position.z - position.z,
      );
      if (distance > radius) continue;

      bot.lastSeen.set(position.x, 0, position.z);
      bot.lastSeenTime = 0;
      bot.alerted = true;
      bot.state = 'search';
      bot.reactionTimer = Math.min(bot.reactionTimer, 0.34);
      bot.repathCooldown = 0;
    }
  }

  hasLineOfSight(from, to) {
    this.tempDirection.copy(to).sub(from);
    const distance = this.tempDirection.length();
    if (distance < 0.01) return true;
    this.tempDirection.normalize();

    this.raycaster.set(from, this.tempDirection);
    this.raycaster.far = distance;
    const hits = this.raycaster.intersectObjects(this.occluders, false);
    return hits.length === 0 || hits[0].distance >= distance - 0.06;
  }

  raycastWorld(origin, direction, maxDistance = 90) {
    this.raycaster.set(origin, direction);
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.occluders, false);
    return hits.length > 0 ? hits[0] : null;
  }

  getHitboxes() {
    const result = [];
    for (const bot of this.bots) {
      if (!bot.alive || !bot.root.visible) continue;
      result.push(...bot.hitMeshes);
    }
    return result;
  }

  getAliveCount() {
    return this.bots.reduce((total, bot) => total + (bot.alive ? 1 : 0), 0);
  }

  getRadarContacts(cameraPosition) {
    const contacts = [];

    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dx = bot.position.x - cameraPosition.x;
      const dz = bot.position.z - cameraPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 28) continue;

      const recentlyHeard = bot.lastShotAt >= 0 && bot.time - bot.lastShotAt < 2.4;
      const visible = this.hasLineOfSight(
        cameraPosition,
        new THREE.Vector3(bot.position.x, 1.15, bot.position.z),
      );

      if (visible || recentlyHeard) {
        contacts.push({
          x: bot.position.x,
          z: bot.position.z,
          visible,
          recentlyHeard,
        });
      }
    }

    return contacts;
  }
}
