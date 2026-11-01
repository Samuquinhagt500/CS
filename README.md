# Tactical Strike — Web Deathmatch

Réplica jogável e didática de um FPS tático clássico, feita com **Three.js + cannon-es** e sem assets externos. O foco desta primeira fase é o modo **Player vs Bots** em uma versão simplificada de um mapa estilo *dust2*.

> Projeto educacional, FPS independente.

---

## Como rodar no VS Code

O projeto é 100% estático, mas usa **ES Modules**. Por isso, abrir `index.html` com duplo clique (`file://`) **não funciona** em navegadores modernos. É necessário um servidor local.

### Opção 1 — Live Server (recomendado)

1. Abra a pasta `D:\Desktop\CS` no VS Code.
2. Instale a extensão **Live Server** (Ritwick Dey), caso ainda não tenha.
3. Clique com o botão direito em `index.html`.
4. Escolha **Open with Live Server**.
5. O navegador abrirá em algo como `http://127.0.0.1:5500`.

### Opção 2 — Python (sem extensões)

No terminal integrado do VS Code:

```powershell
cd D:\Desktop\CS
python -m http.server 5500
```

Depois abra `http://localhost:5500` no Chrome, Edge ou Firefox.

### Opção 3 — Node.js

```powershell
cd D:\Desktop\CS
npx serve .
```

> **Internet:** Three.js e cannon-es são carregados por CDN via `importmap` no `index.html`. É necessária conexão na primeira carga (ou até o cache do navegador). Se quiser funcionamento 100% offline, instale as dependências com npm e aponte o `importmap` para `node_modules`.

---

## Controles

| Entrada | Ação |
|---|---|
| `W A S D` | Movimentação |
| `Shift` | Andar devagar |
| `Ctrl` / `C` | Agachar |
| `Espaço` | Pular / autobhop (segure para bunny hop) |
| `Mouse 1` | Atirar |
| `R` | Recarregar |
| `1` / `2` / roda do mouse | AK-47 / USP |
| `M` | Ligar/desligar som |
| `Esc` | Liberar o mouse / pausar |

Para voltar do pause, clique em **VOLTAR AO JOGO** (o navegador exige um clique para recapturar o Pointer Lock).

---

## Arquivos

```text
CS/
├── index.html   Estrutura da página, HUD, menu, importmap e canvas
├── style.css    HUD retrô, mira dinâmica, radar, menus e overlays
├── game.js      Loop 128 tick, mapa procedural, áudio, efeitos, HUD e partida
├── player.js    Física do jogador, PointerLockControls, armas, recuo e dano
├── bot.js       NavGrid + A*, IA de patrulha/busca/ataque e hitboxes
└── README.md
```

### Responsabilidades

- **`game.js`**
  - Cria o renderer, a cena, a iluminação e o mundo físico.
  - Gera um mapa estilo *dust2* com texturas procedurais em Canvas.
  - Executa o loop fixo de 128 ticks, o timer e o placar.
  - Faz os raycasts dos disparos, hit parts, decais, sangue, tracers e faíscas.
  - Áudio procedural (Web Audio API), radar, kill feed e estados de UI.

- **`player.js`**
  - Câmera em primeira pessoa com `PointerLockControls`.
  - Movimento clássico: fricção no chão, aceleração e `air accelerate` limitado.
  - Bunny hop: segure `Espaço` e faça strafe no ar.
  - Rifle e pistola com pentes, reserva, recarga, cadência, spread e recuo progressivo.
  - Viewmodels low-poly, muzzle flash, bob da câmera, view kick, dano e respawn.

- **`bot.js`**
  - Grade de navegação com A* e suavização de caminho.
  - Estados `patrol`, `search`, `attack` e `dead`.
  - Visão com FOV, linha de visão por raycast e memória da última posição do jogador.
  - Reação, bursts, strafe, precisão por skill, respawn longe do jogador.
  - Hitboxes separadas: cabeça, tronco, braços e pernas.

---

## Fidelidade implementada

- **Movimento:** inércia, aceleração/desaceleração, gravidade de ~20 m/s², pulo com ~1 m de altura, arrancada e autobhop.
- **Arma:** hitscan instantâneo, primeiro tiro preciso parado, spread por velocidade/ar/agachamento, bloom, recuo progressivo do AK-47 e recuperação parcial da mira.
- **Dano:** multiplicador de cabeça (4x), tronco (1x), braços (0,72x) e pernas (0,68x); colete absorve parte do dano.
- **Bots:** patrulha com waypoints, pathfinding, line of sight, reação, rajadas, strafe e resposta a tiros ouvidos.
- **Mapa:** três rotas (mid, túnel B e corredor longo), caixas, barris, coberturas, sites A/B, texturas procedurais e poeira ambiente.
- **HUD:** vida/colete, munição, arma, radar com contatos visíveis, kill feed, hitmarker, headshot, vignette de dano e tela de morte.
- **Partida:** deathmatch até 25 abates ou 10 minutos, respawn do jogador e dos bots, pausa e resultado final.

---

## Ajustes rápidos de gameplay

- **Velocidade do jogador:** `maxSpeed`, `walkSpeed` e `crouchSpeed` em `player.js`.
- **Pulo e gravidade:** `jumpVelocity` em `player.js` e `gravity` em `game.js`.
- **Bunny hop:** `airAccel` e `airWishCap` em `player.js`.
- **Precisão/recuo:** constantes em `WEAPONS` (`baseSpread`, `moveSpread`, `recoilPattern` etc.).
- **Dificuldade dos bots:** faixa de `skill` em `BotManager.setCount()` e dano em `Bot.fireAtPlayer()`.
- **Quantidade de bots:** seletor no menu (`3 / 5 / 7`).
- **Sensibilidade:** slider no menu ou `PointerLockControls.pointerSpeed`.

> O nome `Tactical Strike` foi escolhido para evitar qualquer referência a marcas de terceiros. O projeto é independente e educacional.

---

## Limitações desta fase

- Não há sistema de compra, economia, bombas ou rounds.
- Bots usam apenas AK-47 e não interagem entre si além da separação de colisão.
- O mapa é uma homenagem simplificada a de_dust2, com colisão AABB.
- O áudio é sintetizado em tempo real, sem samples originais.
- Não há multiplayer em rede; o modo é estritamente local.

## Próximos passos sugeridos

1. Sistema de compra e economia.
2. Round bomb (plant/defuse) com objetivos.
3. Mais armas (M4A1, AWP, Desert Eagle, granadas).
4. Ragdolls e animações de recarga/braço.
5. Waypoints táticos por site e cooperação entre bots.
6. Assets e áudio licenciados ou criados para substituir os placeholders.
