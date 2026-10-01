/* =========================================================
 * fidelity.js — DETAIL FIDELITY ENGINE (accuracy layer)
 * Bridges the gap between the generic archetype scaffold and
 * the ACTUAL FORM of the named subject in the user's request.
 *
 * Pipeline position: runs inside Planner.plan() → produces a
 * `spec` object; Blueprinter.fromPlan()/applyOps() materialize
 * that spec into concrete part-graph mutations, so every slot
 * keeps its resolved spec in its blueprint and re-derives
 * details after each adjustment.
 *
 * Everything is offline: SUBJECTS is the local "searched"
 * knowledge base; numeric facts are parsed from Knowledge.FACTS.
 * ======================================================= */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const round3 = (v) => Math.round(v * 1000) / 1000;

  function mergeDeep(base, over) {
    for (const k of Object.keys(over)) {
      const v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        base[k] = mergeDeep(base[k] && typeof base[k] === 'object' ? base[k] : {}, v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  /* ---------- color lexicon (shared with planner) ---------- */
  const COLOR_WORDS = {
    red: '#e5484d', crimson: '#dc143c', scarlet: '#ff2400', maroon: '#7e2a2a',
    orange: '#ff8c1a', rust: '#b7410e', amber: '#ffb01f', yellow: '#ffd233',
    gold: '#d4af37', green: '#3dd68c', olive: '#6b7f35', moss: '#7a9a6e',
    emerald: '#2ecc71', jade: '#1ba774', forest: '#2b7a3d', lime: '#a3e635',
    cyan: '#22d3ee', teal: '#14b8a6', blue: '#3b82f6', azure: '#38bdf8',
    navy: '#1e3a8a', royal: '#4169e1', sky: '#87ceeb', indigo: '#4f46e5',
    purple: '#a855f7', violet: '#8b5cf6', lavender: '#b3a1e6', magenta: '#e879f9',
    pink: '#f472b6', rose: '#e8829a', salmon: '#fa8072', white: '#eef2f7',
    cream: '#f3e9d2', ivory: '#fbf6ea', beige: '#d8c8a8', tan: '#cda06b',
    gray: '#8b95a5', grey: '#8b95a5', charcoal: '#3a3f47', silver: '#c0c7d1',
    black: '#1a1d24', obsidian: '#14161c', brown: '#8a5a3b', chocolate: '#5f3b21',
    bronze: '#cd7f32', copper: '#b87333', khaki: '#bdb76b', sand: '#e2cfa5',
  };

  /* pattern colors → tint modifiers applied on top of base palette */
  const PATTERNS = [
    { re: /\bblack\s+(?:and\s+)?white\b|\bb\/w\b/i, apply: (p) => { p.primary = '#e8e8ec'; p.secondary = '#23262e'; p.accent = '#8b95a5'; p.dark = '#14161c'; p.limb = '#3a3f47'; } },
    { re: /\btuxedo\b/i, apply: (p) => { p.primary = '#23262e'; p.secondary = '#e8e8ec'; p.accent = '#e8e8ec'; p.dark = '#14161c'; } },
    { re: /\bcalico\b/i, apply: (p) => { p.primary = '#e8b04a'; p.secondary = '#f3e9d2'; p.accent = '#7a4a21'; } },
    { re: /\btabby|striped|tiger\b/i, apply: (p) => { p._stripes = true; if (!p.__lockedPrimary) { p.primary = '#e08b2e'; p.accent = '#2b2118'; } } },
    { re: /\bbritish shorthair|siamese|persian|ragdoll\b/i, apply: (p) => { if (!p.__lockedPrimary) { p.primary = '#b7a99a'; p.secondary = '#8f7f6f'; } } },
    { re: /\bgolden retriever|golden\b/i, apply: (p) => { p.primary = '#d9a441'; } },
    { re: /\bred fox\b/i, apply: (p) => { p.primary = '#c9502a'; p.secondary = '#f3e9d2'; } },
    { re: /\bpanda\b/i, apply: (p) => { p.primary = '#e8e8ec'; p.secondary = '#1a1d24'; p.accent = '#1a1d24'; } },
    { re: /\bzebra\b/i, apply: (p) => { p.primary = '#e8e8ec'; p._stripes = true; p.accent = '#1a1d24'; } },
    { re: /\brhino\b/i, apply: (p) => { p.primary = '#8b95a5'; } },
    { re: /\belephant\b/i, apply: (p) => { p.primary = '#9aa0ab'; } },
    { re: /\bgiraffe\b/i, apply: (p) => { p.primary = '#d9a441'; p.accent = '#7a5a1e'; p._spots = true; } },
    { re: /\bleopard|cheetah|jaguar|\bspotted\b|\brosette/i, apply: (p) => { p._spots = true; if (!p.__lockedPrimary) p.primary = '#d9b45c'; p.accent = '#3a2f18'; } },
    { re: /\bsnowy|snow\s?leopard|arctic|polar|\balbino\b/i, apply: (p) => { p.primary = '#f2f4f8'; p.secondary = '#dfe4ee'; } },
    { re: /\bmoss(?:y)?|camo(?:ouflage)?|jungle green\b/i, apply: (p) => { p.primary = '#4f6f3a'; p.secondary = '#3a5230'; } },
    { re: /\bsunset|fire(?:red)?|flame(?:d)?|lava\b/i, apply: (p) => { p.primary = '#e2582a'; p.accent = '#ffb01f'; p.glow = '#ff5a1f'; } },
    { re: /\bsteel|gunmetal|iron\b/i, apply: (p) => { p.primary = '#8b95a5'; p.metal = '#aab4c2'; p.dark = '#2f3540'; } },
    { re: /\bcopper|bronze\b/i, apply: (p) => { p.primary = '#b87333'; p.metal = '#cd7f32'; } },
    { re: /\bchrome\b/i, apply: (p) => { p.primary = '#c9d3de'; p.metal = '#dbe4ee'; } },
    { re: /\bneon\b/i, apply: (p) => { p.glow = '#37e0b0'; p.emissive = 0.6; } },
    { re: /\bmatte\b/i, apply: (p) => { p.rough = 0.85; } },
    { re: /\bweathered|rusty|rusted|battle[- ]?damaged\b/i, apply: (p) => { p.rust = 0.5; p.rough = 0.8; p.secondary = '#7a5230'; } },
    { re: /\bcrystal\b/i, apply: (p) => { p.glass = '#bfe8ff'; p.emissive = 0.3; } },
  ];

  /* ---------- material adjectives ---------- */
  const MATERIALS = [
    { re: /\bwooden|wood\b/i, m: { metalness: -0.1, roughness: +0.25, tint: { primary: '#8a5a3b', dark: '#5f3b21' } } },
    { re: /\bmarble\b/i, m: { roughness: -0.15, tint: { primary: '#e6e2da', masonry: '#efeae2' } } },
    { re: /\bstone|rocky|granite\b/i, m: { roughness: +0.2, tint: { masonry: '#9b938a', primary: '#8f877d' } } },
    { re: /\bbrick\b/i, m: { roughness: +0.15, tint: { masonry: '#a0522d', primary: '#b0603a' } } },
    { re: /\bcrystal(?:line)?|glass(?:y)?|transparent\b/i, m: { emissive: +0.1, tint: { glass: '#cfeaff' } } },
    { re: /\bchrome|polished|shiny|glossy\b/i, m: { metalness: +0.5, roughness: -0.2 } },
    { re: /\bmetal(?:lic)?|steel|iron|aluminum|aluminium|titanium\b/i, m: { metalness: +0.35, roughness: -0.1 } },
    { re: /\bmatte|dull\b/i, m: { roughness: +0.3 } },
    { re: /\brusty|weathered|corroded\b/i, m: { roughness: +0.3, metalness: -0.2, tint: { rust: 0.5 } } },
    { re: /\bglow(?:ing)?|luminous|bioluminescent|radiant\b/i, m: { emissive: +0.5 } },
  ];

  /* ---------- numeric phrase extraction ---------- */
  const NUM_WORDS = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twelve:12,double:2,triple:3,quadruple:4,multiple:4 };
  const NUMRE = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|double|triple|quadruple)';
  function toNum(tok) {
    if (tok == null) return null;
    const s = String(tok).toLowerCase();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return NUM_WORDS[s] != null ? NUM_WORDS[s] : null;
  }
  const COUNT_PATTERNS = [
    { re: new RegExp(NUMRE + '\\s+(?:pairs?\\s+of\\s+)?(?:pointed\\s+|sharp\\s+|large\\s+|small\\s+|floppy\\s+)?ears?', 'i'), set: 'earCount', mul: 1 },
    { re: new RegExp(NUMRE + '\\s+pairs?\\s+of\\s+wings', 'i'), set: 'wingCount', mul: 2 },
    { re: new RegExp(NUMRE + '\\s+(?:pairs?\\s+of\\s+)?(?:feathered\\s+|bat\\s+|angel\\s+)?wings?', 'i'), set: 'wingCount', mul: 1 },
    { re: new RegExp(NUMRE + '\\s+(?:pairs?\\s+of\\s+)?(?:curved\\s+|spiral\\s+|sharp\\s+|single\\s+|multiple\\s+|extra\\s+)?horns?', 'i'), set: 'hornCount', mul: 1 },
    { re: new RegExp(NUMRE + '\\s+(?:sturdy\\s+|long\\s+|short\\s+|spindly\\s+)?(?:legs?|limbs?)', 'i'), set: 'legCount', mul: 1 },
    { re: /(\d+)\s*(?:stories|floors?)/i, set: 'floors', mul: 1 },
    { re: /(\d+)\s*(?:turrets?|towers?)/i, set: 'towerCount', mul: 1 },
    { re: /(\d+)\s*eyes?/i, set: 'eyeCount', mul: 1 },
    { re: /(\d+)\s*tails?/i, set: 'tailCount', mul: 1 },
  ];

  /* ---------- adjective-driven parameters (set → assign, mul → stack) ---------- */
  const ADJ_RULES = [
    { set: { earMode: 'floppy' }, re: /\bfloppy|droopy/i },
    { set: { pointedEars: 1 }, re: /\bpointed\s+ears?|\blarge\s+ears?|\bbig\s+ears?/i },
    { set: { roundEars: 1 }, re: /\bround\s+ears?/i },
    { set: { batEars: 1 }, re: /\bbat[\s-]?ears?\b/i },
    { mul: { wideStance: 1.25 }, re: /\bwide\s+(?:stance|shoulders?|body)/i },
    { mul: { narrow: 0.8 }, re: /\bnarrow\b/i },
    { mul: { fluffy: 1.14 }, re: /\bfluffy|plush|chubby|fluffball/i },
    { mul: { slender: 0.82 }, re: /\bskinny|slender|lanky|gangly/i },
    { mul: { bulky: 1.2 }, re: /\bmuscular|bulky|burly|heavily[\s-]?built/i },
    { mul: { mini: 0.7 }, re: /\bdwarf(?:ish)?|teacup\b/i },
    { mul: { barrelChest: 1.18 }, re: /\bbarrel[\s-]?chested?/i },
    { set: { hump: 1 }, re: /\bhump(?:ed|back)?\b/i },
    { set: { beak: 1 }, re: /\bbeak\b/i },
    { set: { webbed: 1 }, re: /\bwebbed\b/i },
    { set: { mane: 1 }, re: /\bmane\b/i },
    { set: { whiskers: 1 }, re: /\bwhiskers?\b/i },
    { set: { finDorsal: 1 }, re: /\bfins?\b(?!h)/i },
    { set: { shell: 1 }, re: /\bshell\b/i },
    { set: { featherTuft: 1 }, re: /\bfeather(?:s|ed|d)?\b/i },
    { set: { teethRow: 1 }, re: /\bsaber[\s-]?tooth|\bserrated|\bteeth\b/i },
    { set: { armorPlates: 1 }, re: /\barmored|armoured\b/i },
    { set: { segments: 1 }, re: /\bsegment(?:ed|s)\b/i },
    { set: { glasses: 1 }, re: /\bglasses?\b(?!y)/i },
    { set: { crownWorn: 1 }, re: /\bwearing a crown|\bcrowned\b/i },
    { set: { collar: 1 }, re: /\bcollar\b/i },
    { set: { antennaPair: 1 }, re: /\ban(?:tenna|sennae|tennas)\b/i },
    { set: { mohawk: 1 }, re: /\bmohawk\b/i },
    { set: { wrinkles: 1 }, re: /\bwrinkles?/i },
    { set: { tusks: 1 }, re: /\btusk(?:s|ed)?\b/i },
    { set: { trunk: 1 }, re: /\btrunk\b(?!top)/i },
    { set: { proboscis: 1 }, re: /\bproboscis\b/i },
    { set: { hooves: 1 }, re: /\bhooves?\b/i },
    { set: { pouch: 1 }, re: /\bpouch\b/i },
    { set: { bill: 1 }, re: /\bbill\b/i },
    { set: { curlyTail: 1 }, re: /\bcurl(?:ed|y)\s+tail|\bstubby tail|bobtail/i },
    { set: { wattles: 1 }, re: /\bwattle(?:s)?\b/i },
    { set: { bigJaws: 1 }, re: /\bcarnivorous|\bman[- ]?eater|\bmeathead/i },
    { set: { domeShell: 1 }, re: /\bdomed?\b/i },
    { set: { steppedPyramid: 1 }, re: /\bstepped?\s+pyramid|step pyramid/i },
    { set: { gothic: 1 }, re: /\bgothic\b/i },
    { set: { sleek: 1 }, re: /\bmodern|minimalist(?:ic)?|sleek\b/i },
    { set: { tiltDeg: 8 }, re: /\bbent|leaning|crooked|wonky|lopsided/i },
    { set: { rotatingTop: 1 }, re: /\brotating\b/i },
    { set: { bionic: 1 }, re: /\bbionic\b/i },
    { set: { steampunk: 1 }, re: /\bsteampunk\b/i },
    { set: { katanaCurve: 1 }, re: /\bkatana\b/i },
    { set: { clawTips: 1 }, re: /\bclaw(?:s|ed)?\b/i },
    { set: { glowEyes: 1 }, re: /\bglowing\s+eyes?|\bred\s+eyes?|laser\s+eyes?/i },
    { set: { streamlined: 1 }, re: /\bstreamlin(?:e|ed|er)|aero(?:dynamic)?\b/i },
    { set: { coil: 1 }, re: /\bcoiled?\b/i },
    { set: { dragonHead: 1, spikesBack: 1 }, re: /\bdragon\b/i },
    { set: { dragonHead: 1 }, re: /\bwyvern\b/i },
    { set: { quadJets: 1 }, re: /\bquad(?:ruped)?[\s-]?(?:jet|engine|thruster)s?\b/i },
    { set: { helmet: 1 }, re: /\bhelmet\b/i },
    { set: { cockpitGlass: 1 }, re: /\bcanopy\b/i },
    { set: { landingSkids: 1 }, re: /\blanding\s+(?:gear|skid)s?\b/i },
    { set: { propeller: 1 }, re: /\bpropeller\b/i },
    { set: { doubleBlade: 1 }, re: /\bdouble[\s-]?bladed?\b/i },
  ];

  /* ---------- size words → scale multipliers ---------- */
  const SIZE_HINTS = [
    { re: /\bcolossal|colossus|god[\s-]?zilla|kaiju|titan(?:ic)?\b/i, s: 3.2 },
    { re: /\bgiant|huge|massive|enormous|big\b/i, s: 1.8 },
    { re: /\bmacro\b/i, s: 1.4 },
    { re: /\bmini(?:mal)?[\s-]?(?:model|version)?\b|\bcompact\b/i, s: 0.75 },
    { re: /\btiny|small|little|cute|kawaii|miniature|teacup\b/i, s: 0.55 },
    { re: /\btoy\b/i, s: 0.45 },
  ];

  /* =========================================================
   * SUBJECT LEXICON — named subjects with actual-form detail
   * deltas over their base archetype scaffold. Each entry:
   *   arch : archetype whose generic scaffold gets refined
   *   via  : optional parent subject merged first (composites)
   *   kw   : keyword forms that identify the subject
   *   d    : detail deltas merged onto the scaffold
   * ======================================================= */
  const SUBJECTS = {
    /* ---------------- animals ---------------- */
    dog: { arch:'quadruped', kw:['dog','dogs','puppy','labrador','beagle','bulldog','hound','retriever','terrier','dachshund','chihuahua','german shepherd','husky','corgi','poodle','mutt','canine'],
      d:{ earMode:'floppy', snoutMul:1.15, tailWag:1, bodyLen:1.05 } },
    cat: { arch:'quadruped', kw:['cat','cats','kitten','kitty','feline','tabby','siamese','persian','calico','maine coon'],
      d:{ earMode:'pointed', headRound:1.1, snoutMul:0.72, tailLen:1.3, tailUp:1, whiskers:1, slender:0.92 } },
    wolf: { arch:'quadruped', kw:['wolf','wolves','dire wolf','timber wolf'],
      d:{ earMode:'pointed', snoutMul:1.25, muzzleDark:1, tailBushy:1.35, bodyLen:1.1, ruff:1.15 } },
    fox: { arch:'quadruped', kw:['fox','foxes','fennec','arctic fox','red fox'],
      d:{ earMode:'batEars', earScale:1.5, snoutMul:1.1, tailBushy:1.5, whiteTipTail:1, slender:0.85 } },
    lion: { arch:'quadruped', kw:['lion','lioness','lions'],
      d:{ mane:1, earMode:'round', snoutMul:1.2, stocky:1.15, tailTuft:1 } },
    tiger: { arch:'quadruped', kw:['tiger','tigers','bengal tiger'],
      d:{ stripes:1, earMode:'round', snoutMul:1.15, stocky:1.1, tailLen:1.25 } },
    leopard: { arch:'quadruped', kw:['leopard','jaguar','cheetah','panther','cougar','lynx'],
      d:{ spots:1, earMode:'round', slender:0.88, tailLen:1.35 } },
    bear: { arch:'quadruped', kw:['bear','bears','grizzly','polar bear','teddy bear','panda'],
      d:{ earMode:'round', headRound:1.35, bulky:1.3, stubbyTail:1, legScale:1.1, shoulderHump:1 } },
    horse: { arch:'quadruped', kw:['horse','horses','pony','stallion','mare','mustang','foal','clydesdale'],
      d:{ neckLong:1.5, legScale:1.5, headElong:1.45, earMode:'pointed', mane:1, tailFlow:1.6, bodyLen:1.25, hoofFeet:1 } },
    zebra: { arch:'quadruped', kw:['zebra','zebras'],
      d:{ neckLong:1.35, legScale:1.35, headElong:1.3, mane:1, stripes:1, earMode:'pointed', tailFlow:1.3 } },
    deer: { arch:'quadruped', kw:['deer','stag','elk','moose','reindeer','caribou','fawn'],
      d:{ antlers:1, legScale:1.4, slender:0.85, earMode:'pointed', headElong:1.15, stubbyTail:1, whiteRump:1 } },
    giraffe: { arch:'quadruped', kw:['giraffe','giraffes'],
      d:{ neckLong:2.6, ossicone:1, legScale:1.7, spots:1, earMode:'pointed', tailFlow:1.2, headElong:1.25 } },
    elephant: { arch:'quadruped', kw:['elephant','elephants','mammoth'],
      d:{ trunk:1, earMode:'flap', earScale:2.6, bulky:1.45, legScale:1.25, stubbyTail:1, tusks:1 } },
    rhino: { arch:'quadruped', kw:['rhino','rhinoceros','hippo','hippopotamus'],
      d:{ hornNasal:1, bulky:1.35, skinThick:1, headRound:1.25, stubbyTail:1, legScale:0.95 } },
    camel: { arch:'quadruped', kw:['camel','camels','dromedary','llama','alpaca'],
      d:{ hump:1, neckLong:1.6, legScale:1.3, earMode:'floppy' } },
    kangaroo: { arch:'bipedal', kw:['kangaroo','wallaby'],
      d:{ hopperPose:1, hindScale:1.5, tailProp:1.6, armScale:0.55, earMode:'pointed', pouch:1 } },
    rabbit: { arch:'quadruped', kw:['rabbit','bunny','hare','cottontail'],
      d:{ earMode:'longEars', earScale:2.2, tailPompom:1, hindScale:1.25, headRound:1.15, whiskers:1, compactBody:0.9 } },
    mouse: { arch:'quadruped', kw:['mouse','mice','rat','hamster','gerbil'],
      d:{ earMode:'round', earScale:1.8, tailThinLong:1.6, whiskers:1, snoutMul:1.2 } },
    squirrel: { arch:'quadruped', kw:['squirrel','chipmunk'],
      d:{ tailBushy:1.8, tailUp:1, earMode:'longEars', earScale:1.2, hindScale:1.15 } },
    monkey: { arch:'bipedal', kw:['monkey','ape','gorilla','chimp','orangutan','lemur','baboon'],
      d:{ armScale:1.4, prehensileTail:1, earMode:'round', chestWide:1.15, legScale:0.85 } },
    bat: { arch:'creature_winged', kw:['bat','bats','vampire bat'],
      d:{ earMode:'batEars', earScale:1.8, wingMembrane:1, clawTips:1 } },
    pig: { arch:'quadruped', kw:['pig','piglet','hog','swine'],
      d:{ snoutDisc:1, curlyTail:1, earMode:'floppy', barrelChest:1.2, legScale:0.85 } },
    cow: { arch:'quadruped', kw:['cow','cows','bull','ox','cattle','yak','bison','buffalo'],
      d:{ horns:1, udder:1, earMode:'floppy', bulky:1.25, tailFlow:1.1 } },
    goat: { arch:'quadruped', kw:['goat','sheep','ram','ewe','lamb'],
      d:{ horns:1, earMode:'floppy', beard:1, hoofFeet:1, wool:1, slender:0.92 } },
    frog: { arch:'quadruped', kw:['frog','toad'],
      d:{ bulgingEyes:1, squatBody:0.85, longHind:1.35, wideMouth:1.25 } },
    turtle: { arch:'quadruped', kw:['turtle','tortoise'],
      d:{ shell:1, shellDomed:1.2, legScale:0.7, stubbyTail:1 } },

    /* ---------------- birds ---------------- */
    eagle: { arch:'avian', kw:['eagle','hawk','falcon','osprey','condor'],
      d:{ hookedBeak:1, wingSpanMul:1.35, talons:1, tailFan:1.1 } },
    owl: { arch:'avian', kw:['owl','owls','barn owl'],
      d:{ facialDisc:1, earTufts:1, eyeScale:1.6, headRound:1.3, bodyCompact:0.95 } },
    parrot: { arch:'avian', kw:['parrot','macaw','cockatoo','budgie','toucan','lovebird'],
      d:{ curvedBeakBig:1, crest:1, tailLong:1.5 } },
    penguin: { arch:'avian', kw:['penguin','penguins'],
      d:{ flipperWings:1, upright:1, tuxedoMark:1, noTail:1, beak:1, bellyWhite:1 } },
    chicken: { arch:'avian', kw:['chicken','rooster','hen','duck','goose','turkey','swan','flamingo','peacock','ostrich','bird','birds'],
      d:{ comb:1, wattles:1, beak:1, tailFan:1, bodyCompact:1.05 } },
    dove: { arch:'avian', kw:['dove','pigeon','sparrow','crow','raven','seagull','pelican','heron','hummingbird'],
      d:{ slimBeak:1, wingSpanMul:1.1, tailFan:0.9 } },

    /* ---------------- reptiles / sea ---------------- */
    trex: { arch:'dino', kw:['trex','t-rex','tyrannosaurus','tyrant rex'],
      d:{ headMass:1.45, tinyArms:1, jawTeeth:1, tailHeavy:1.25, bipedalLean:1 } },
    raptor: { arch:'dino', kw:['raptor','velociraptor','deinonychus','troodon'],
      d:{ sickleClaw:1, armsFunctional:1.2, feathers:1, tailStiff:1.15, sprintPose:1 } },
    ceratopsian: { arch:'quadruped', kw:['triceratops','tricera','stegosaurus','ankylosaurus','brachiosaurus','diplodocus','spinosaurus','pterosaur','pterodactyl','dinosaur','dinosaurs','dino'],
      d:{ frillShield:1, threeHornSet:1, beakMouth:1, bulky:1.3, quadrupedStance:1, tailHeavy:1, spikesBack:1 } },
    snake: { arch:'serpentine', kw:['snake','python','cobra','boa','viper','anaconda','adder'],
      d:{ hoodFlare:1, forkedTongue:1, coilTight:1, scales:1 } },
    crocodile: { arch:'serpentine', kw:['crocodile','croc','alligator','gator','caiman'],
      d:{ longSnout:3.1, armoredBack:1, deathRollTail:1.3, teethRow:1, lowSlung:1 } },
    shark: { arch:'serpentine', kw:['shark','great white','hammerhead','mako'],
      d:{ dorsalFin:1, tailFluke:1.4, gillSlits:1, coneTeeth:1, pectoralFins:1 } },
    whale: { arch:'serpentine', kw:['whale','whales','orca','killer whale','dolphin','beluga','narwhal'],
      d:{ blowhole:1, tailFluke:1.5, flippers:1, dorsalFin:1, bodyMassive:1.6 } },
    octopus: { arch:'hexapod', kw:['octopus','squid','kraken','cuttlefish'],
      d:{ tentacleCount:8, bulbHead:1.5, suckers:1, podBody:1, eyeScale:1.6 } },
    arthropod: { arch:'hexapod', kw:['crab','lobster','shrimp','prawn','scorpion','spider','insect','ant','bee','wasp','beetle','butterfly','moth','mosquito','grasshopper'],
      d:{ pincerClaws:1, carapace:1, compoundEyes:1, antennae:1, exoskeletonSheen:1 } },

    /* ---------------- fantasy ---------------- */
    dragon: { arch:'serpentine', kw:['dragon','dragons','wyvern','drake','hydra'],
      d:{ dragonHead:1, horns:1, wings:1, spikesBack:1, tailBarbed:1.2, fireBreath:1, fourLimbs:1, headMass:1.2 } },
    phoenix: { arch:'avian', kw:['phoenix'],
      d:{ flamePlume:1, tailLong:1.8, glowEyes:1, crest:1 } },
    griffin: { arch:'creature_winged', kw:['griffin','gryphon','hippogriff'],
      d:{ eagleHead:1, hookedBeak:1, tuftedEars:1, hindquarters:1, wings:1, talons:1 } },
    pegasus: { arch:'quadruped', kw:['pegasus','alicorn'],
      d:{ wings:1, neckLong:1.4, legScale:1.45, mane:1, tailFlow:1.5, hoofFeet:1, headElong:1.4 } },
    unicorn: { via:'horse', arch:'quadruped', kw:['unicorn','unicorns'],
      d:{ spiralHorn:1, whiteCoat:1 } },
    mermaid: { arch:'serpentine', kw:['mermaid','merman','triton'],
      d:{ tailFluke:1.3, humanoidTop:1, finsSide:1 } },
    yeti: { arch:'bipedal', kw:['yeti','abominable snowman','sasquatch','bigfoot'],
      d:{ furBulk:1.35, armScale:1.3, whiteFur:1 } },
    goblin: { arch:'bipedal', kw:['goblin','orc','troll','imp','gremlin'],
      d:{ bigPointedEars:1.7, hunched:1, snoutMul:1.2, smallStature:0.8, tusks:1 } },
    vampire: { arch:'bipedal', kw:['vampire','dracula'],
      d:{ capeCollar:1, fangs:1, paleSkin:1 } },
    ghost: { arch:'bipedal', kw:['ghost','spirit','wraith','phantom'],
      d:{ translucent:1, wavyBottom:1, hollowEyes:1, floating:1 } },
    angel: { arch:'bipedal', kw:['angel','cherub','seraph'],
      d:{ haloRing:1, featheredWings:1, robeFlare:1 } },
    demon: { arch:'bipedal', kw:['demon','devil','succubus'],
      d:{ curvedHorns:1, batWings:1, spadeTail:1, hooves:1, redSkin:1 } },
    skeleton: { arch:'bipedal', kw:['skeleton','bone warrior'],
      d:{ skullHead:1, ribcage:1, thinLimbBones:0.65, spineSegments:1 } },
    zombie: { arch:'bipedal', kw:['zombie','ghoul','undead'],
      d:{ outstretchedArms:1, tornClothes:1, greenSkin:1, slumpedShoulders:1 } },
    mummy: { arch:'bipedal', kw:['mummy'],
      d:{ bandageWrap:1, stiffArms:1, goldenMask:1 } },
    wizard: { arch:'bipedal', kw:['wizard','mage','sorcerer','warlock','witch'],
      d:{ pointyHat:1, robeFlare:1, staff:1, beardLong:1 } },
    knight: { arch:'mechwalker', kw:['knight','paladin','crusader','templar'],
      d:{ armorPlates:1, plumedHelmet:1, swordArm:1, shieldBack:1, tabard:1 } },
    samurai: { arch:'mechwalker', kw:['samurai','ronin','shogun'],
      d:{ lacquerArmor:1, helmet:1, katanaCurve:1, faceMask:1 } },
    superhero: { arch:'bipedal', kw:['superhero','super hero','avenger','vigilante'],
      d:{ cape:1, chestEmblem:1, maskDomino:1, heroicPhysique:1.15 } },
    pirate: { arch:'bipedal', kw:['pirate','buccaneer','corsair'],
      d:{ tricornHat:1, eyepatch:1, hookHand:1, cutlassHip:1 } },
    ninja: { arch:'bipedal', kw:['ninja','shinobi'],
      d:{ faceMask:1, backKatana:1, scarfTrailing:1, darkGarb:1 } },
    astronaut: { via:'robot', arch:'bipedal', kw:['astronaut','spaceman','space man'],
      d:{ bubbleHelmet:1, backpackJet:1, suitPuffs:1.2, flagPatch:1 } },

    /* ---------------- robots / vehicles ---------------- */
    robot: { arch:'bipedal', kw:['robot','robots','droid','android','cyborg','bot','automaton'],
      d:{ antennaPair:1, panelLines:1, glowingVisor:1, boxyTorso:1.1, boltJoints:1, clawHands:1 } },
    mech: { arch:'mechwalker', kw:['mech','mecha','gundam','power armor','exoskeleton','evangelion'],
      d:{ oversizedShoulders:1.3, cockpitChest:1, hydraulicLegs:1, headVisor:1, backpackThrusters:1 } },
    drone: { arch:'ufoCraft', kw:['drone','drones','quadcopter','uav','multirotor'],
      d:{ quadRotorArms:1, cameraGimbal:1, landingSkids:1, flatFrame:1 } },
    ufo: { arch:'ufoCraft', kw:['ufo','ufos','flying saucer','space disc'],
      d:{ tractorBeam:1, rimLights:8, domeGlass:1 } },
    rocket: { arch:'spaceship', kw:['rocket','rockets','launch vehicle','falcon 9','missile'],
      d:{ tallVertical:2.6, engineBell:1, gridFins:1, noseFairing:1 } },
    fighterJet: { arch:'aircraft', kw:['fighter jet','jet fighter','f16','f-16','f22','f-22','su-27','mig','strike aircraft','interceptor'],
      d:{ sweptWings:1, twinTails:1, cockpitGlass:1, afterburnerGlow:1, missilePods:1 } },
    airliner: { arch:'aircraft', kw:['airliner','boeing','airbus','passenger plane','747','jetliner'],
      d:{ windowRows:1, winglets:1, enginePodsUnder:1, cargoDoors:1, longFuselage:1.3 } },
    biplane: { arch:'aircraft', kw:['biplane','cessna','propeller plane','crop duster'],
      d:{ doubleWings:1, propeller:1, strutsBracing:1, openCockpit:1, tailwheelGear:1 } },
    helicopter: { arch:'aircraft', kw:['helicopter','heli','copter','apache chopper','black hawk'],
      d:{ mainRotor:1, tailRotor:1, landingSkids:1, stubWings:1, cockpitGlass:1 } },
    sportsCar: { arch:'vehicle', kw:['sports car','supercar','race car','formula','f1 car','lamborghini','ferrari','porsche','coupe'],
      d:{ lowProfile:0.72, wideRear:1.2, rearSpoiler:1, diffuserRear:1, racingStripes:1 } },
    truck: { arch:'vehicle', kw:['truck','trucks','semi truck','pickup','tractor trailer','lorry','big rig','dump truck','fire truck','fire engine'],
      d:{ sleeperCab:1, exhaustStacks:1, extraRearAxles:1, flatbed:1, chromeBumper:1 } },
    bus: { arch:'vehicle', kw:['bus','buses','school bus','coach','tram','streetcar','minivan','van'],
      d:{ longBoxBody:1.9, windowRows:1, doubleRearAxle:1, roofHatch:1, flatFront:1 } },
    tank: { arch:'tankVehicle', kw:['tank','tanks','panzer','tiger tank','sherman','abrams','leopard 2','armored tank'],
      d:{ longBarrel:1.25, sideSkirts:1, commanderCupola:1, roadWheelCount:7 } },
    motorcycle: { arch:'vehicle', kw:['motorcycle','motorbike','chopper bike','dirt bike','scooter','harley'],
      d:{ inlineWheels:1, handlebars:1, exhaustPipes:1, seatHump:1, narrowFrame:0.45 } },
    train: { arch:'vehicle', kw:['train','trains','locomotive','steam engine','subway','bullet train','shinkansen'],
      d:{ boilerTube:1, smokestack:1, cowcatcher:1, cabRoof:1, drivingWheels:1, pantograph:1 } },
    ship: { arch:'vehicle', kw:['ship','boat','boats','sailboat','galleon','cruise ship','sloop','pirate ship','speedboat','submarine'],
      d:{ hullKeel:1, bowPointed:1, mastSails:1, bridgeTower:1, sternDeck:1 } },

    /* ---------------- architecture ---------------- */
    skyscraper: { arch:'building', kw:['skyscraper','skyscrapers','highrise','office tower','tower block'],
      d:{ setbackSteps:1, spireAntenna:1, curtainWindows:1, podiumBase:1, floorsHint:12 } },
    house: { arch:'building', kw:['house','houses','home','cottage','cabin','bungalow','villa','treehouse','log cabin'],
      d:{ pitchedRoof:1, chimney:1, porchColumns:1, dormerWindow:1, picketFence:1 } },
    castle: { arch:'castle', kw:['castle','castles','fortress','citadel','keep','bastion'],
      d:{ crenellations:1, cornerTowers:1, gatehouseArch:1, moatRing:1, drawbridge:1, keepTower:1.25, flagsOnTowers:1 } },
    pagoda: { arch:'building', kw:['pagoda','temple','shrine','church','cathedral','mosque','monastery','synagogue'],
      d:{ tieredRoofs:4, upturnedEaves:1, finialSpire:1, prayerFlags:1 } },
    lighthouse: { arch:'building', kw:['lighthouse','beacon tower'],
      d:{ taperTower:1, lampRoomGlass:1, galleryRail:1, stripePattern:1 } },
    bridge: { arch:'building', kw:['bridge','suspension bridge','arch bridge','drawbridge','viaduct','aqueduct'],
      d:{ deckSpan:3.2, suspensionCables:1, twinTowers:1, railingPosts:1 } },
    pyramid: { arch:'building', kw:['pyramid','ziggurat','mausoleum'],
      d:{ steppedPyramid:1, squareBase:1, capstoneGold:1, causeway:1 } },
    windmill: { arch:'building', kw:['windmill','water mill','pinwheel'],
      d:{ rotatingBlades:4, taperedBody:1, balconyRing:1 } },
    ferrisWheel: { arch:'building', kw:['ferris wheel','observation wheel','carousel','merry go round'],
      d:{ spokeWheel:1, gondolaSeats:12, twinAFrame:1, rotatingTop:1 } },
    monument: { arch:'building', kw:['monument','obelisk','statue','memorial','totem pole','eiffel tower','tower of pisa'],
      d:{ taperStone:1, pedestalBase:1, inscribedPanel:1 } },

    /* ---------------- objects / props / flora ---------------- */
    sword: { arch:'weaponblade', kw:['sword','swords','katana','longsword','broadsword','rapier','scimitar','claymore','dagger'],
      d:{ fullerGroove:1, wrappedGrip:1, quillonGuard:1, gemPommel:1 } },
    axe: { arch:'weaponblade', kw:['axe','axes','halberd','mace','warhammer','cleaver','hatchet'],
      d:{ axeHeadBlade:1, haftLength:1.4, spikeButt:1 } },
    chair: { arch:'furniture', kw:['chair','chairs','armchair','rocking chair','throne','office chair','stool'],
      d:{ cushionSeat:1, armRests:1, crossBrace:1 } },
    table: { arch:'furniture', kw:['table','tables','desk','workbench','coffee table','dining table'],
      d:{ thickTop:1.4, apronFrame:1, turnedLegs:1, drawerUnit:1 } },
    sofa: { arch:'furniture', kw:['sofa','couch','loveseat','sectional'],
      d:{ backCushions:3, rolledArms:1, skirtBase:1 } },
    bed: { arch:'furniture', kw:['bed','beds','four poster','bunk bed','hammock'],
      d:{ mattressPad:1, headboard:1, pillows:2, footBoard:1 } },
    lamp: { arch:'furniture', kw:['lamp','lamps','lantern','torch','candle'],
      d:{ shadeCone:1, glowCore:1, baseStand:1 } },
    guitar: { arch:'weaponblade', kw:['guitar','guitars','violin','cello','harp','ukulele','lute'],
      d:{ figure8Body:1, soundHole:1, fretboardNeck:1, tuningPegs:6 } },
    clock: { arch:'ufoCraft', kw:['clock','clocks','pocket watch','grandfather clock','hourglass','big ben'],
      d:{ roundFace:1, hourMarkers:12, handsPair:1 } },
    trophy: { arch:'furniture', kw:['trophy','medal','grail','chalice','urn','vase'],
      d:{ cupBowl:1, stemColumn:1, plaqueBase:1, handlesPair:1 } },
    crown: { arch:'weaponblade', kw:['crown','crowns','tiara','circlet'],
      d:{ ringBand:1, pointsCount:5, jewelStuds:1 } },
    crate: { arch:'building', kw:['crate','chest','box','locker','safe','suitcase','barrel','keg'],
      d:{ plankSlats:1, cornerIron:1, lidSeam:1, lockLatch:1 } },
    donut: { arch:'ufoCraft', kw:['donut','donuts','doughnut','bagel','pizza','pancake','hamburger','burger','cake','cupcake','cookie'],
      d:{ torusFood:1, frostingTop:1, sprinkles:1 } },
    mushroom: { arch:'tree', kw:['mushroom','mushrooms','toadstool','fungus'],
      d:{ capDome:1.6, gillsUnder:1, spottedCap:1, thickStem:1.3 } },
    cactus: { arch:'tree', kw:['cactus','cacti','succulent','aloe'],
      d:{ columnArms:1, spines:1, potBase:1, ribbedSkin:1 } },
    flower: { arch:'tree', kw:['flower','flowers','rose','tulip','sunflower','daisy','lotus','orchid','bonsai','fern'],
      d:{ petalRing:8, centerDisk:1, leafPair:1, slimStem:1 } },
    conifer: { arch:'tree', kw:['pine','spruce','evergreen','christmas tree','fir'],
      d:{ conicalShape:1, layeredCanopy:1, barkTexture:1 } },
    broadleaf: { arch:'tree', kw:['oak','maple','birch','willow','palm tree','tree','trees'],
      d:{ layeredCanopy:1, rootFlareBig:1.3, barkTexture:1 } },
    snowman: { arch:'bipedal', kw:['snowman','snow golem'],
      d:{ stackedSpheres:3, carrotNose:1, stickArms:1, coalEyes:1, topHat:1, scarfWrap:1 } },
  };

  /* extra keyword routing for names not worth whole entries */
  const EXTRA_ROUTES = [
    [/\blabrador|golden retriever|german shepherd|bulldog|beagle|husky|corgi|poodle|dachshund|chihuahua|shiba\b/i, 'dog'],
    [/\bsiamese|maine coon|persian|calico|kitten\b/i, 'cat'],
    [/\bdire wolf|timber wolf\b/i, 'wolf'],
    [/\bred fox|arctic fox|fennec\b/i, 'fox'],
    [/\bbengal tiger|siberian tiger\b/i, 'tiger'],
    [/\bcheetah|jaguar|panther|lynx|cougar\b/i, 'leopard'],
    [/\bgrizzly|polar bear|panda|koala\b/i, 'bear'],
    [/\bstallion|mare|clydesdale|pony\b/i, 'horse'],
    [/\breindeer|elk|moose|caribou|fawn\b/i, 'deer'],
    [/\bhippo|hippopotamus\b/i, 'rhino'],
    [/\bdromedary|llama|alpaca\b/i, 'camel'],
    [/\bwallaby\b/i, 'kangaroo'],
    [/\bhare|cottontail\b/i, 'rabbit'],
    [/\bhamster|gerbil\b/i, 'mouse'],
    [/\bchimp|gorilla|orangutan|lemur|baboon\b/i, 'monkey'],
    [/\bpiglet\b/i, 'pig'],
    [/\bbull|cattle|yak|bison|buffalo\b/i, 'cow'],
    [/\bsheep|ram|lamb|ewe\b/i, 'goat'],
    [/\bhawk|falcon|osprey|condor\b/i, 'eagle'],
    [/\bmacaw|cockatoo|budgie|toucan\b/i, 'parrot'],
    [/\brooster|hen|turkey|peacock|duck|goose|swan|flamingo\b/i, 'chicken'],
    [/\bheron|pelican|seagull|sparrow|raven|crow\b/i, 'dove'],
    [/\btyrannosaurus|t[\s-]?rex\b/i, 'trex'],
    [/\bvelociraptor|deinonychus\b/i, 'raptor'],
    [/\bstegosaurus|ankylosaurus|brachiosaurus|diplodocus|spinosaurus|pterosaur|pterodactyl\b/i, 'ceratopsian'],
    [/\balligator|gator|caiman\b/i, 'crocodile'],
    [/\bpython|cobra|anaconda|viper|boa\b/i, 'snake'],
    [/\borca|dolphin|beluga|narwhal\b/i, 'whale'],
    [/\bkraken|squid|cuttlefish\b/i, 'octopus'],
    [/\blobster|shrimp|prawn\b/i, 'arthropod'],
    [/\bwyvern|drake|hydra\b/i, 'dragon'],
    [/\bgryphon|hippogriff\b/i, 'griffin'],
    [/\balicorn\b/i, 'pegasus'],
    [/\babominable snowman|sasquatch|bigfoot\b/i, 'yeti'],
    [/\borc|troll|imp|gremlin\b/i, 'goblin'],
    [/\bdracula\b/i, 'vampire'],
    [/\bwraith|phantom\b/i, 'ghost'],
    [/\bcherub|seraph\b/i, 'angel'],
    [/\bsuccubus\b/i, 'demon'],
    [/\bghoul|undead\b/i, 'zombie'],
    [/\bsorcerer|warlock|mage|witch\b/i, 'wizard'],
    [/\bpaladin|templar|crusader\b/i, 'knight'],
    [/\bronin|shogun\b/i, 'samurai'],
    [/\bavenger|vigilante\b/i, 'superhero'],
    [/\bbuccaneer|corsair\b/i, 'pirate'],
    [/\bshinobi\b/i, 'ninja'],
    [/\bdroid|android|cyborg|automaton\b/i, 'robot'],
    [/\bmecha|gundam|evangelion|power armor|exoskeleton\b/i, 'mech'],
    [/\bquadcopter|uav|multirotor\b/i, 'drone'],
    [/\bsaucer\b/i, 'ufo'],
    [/\blaunch vehicle|falcon 9|missile\b/i, 'rocket'],
    [/\bf[\s-]?16|f[\s-]?22|su[\s-]?27|mig[\s-]?\d*|interceptor\b/i, 'fighterJet'],
    [/\bboeing|airbus|747|passenger plane|jetliner\b/i, 'airliner'],
    [/\bcessna|crop duster\b/i, 'biplane'],
    [/\bheli\b|apache chopper|black hawk\b/i, 'helicopter'],
    [/\bsupercar|lamborghini|ferrari|porsche|coupe\b/i, 'sportsCar'],
    [/\bsemi\b|tractor trailer|lorry|big rig|dump truck|fire truck|fire engine|pickup\b/i, 'truck'],
    [/\bschool bus|streetcar|tram|minivan\b/i, 'bus'],
    [/\bpanzer|sherman|abrams|leopard 2|tiger tank\b/i, 'tank'],
    [/\bmotorbike|dirt bike|scooter|harley\b/i, 'motorcycle'],
    [/\blocomotive|subway|shinkansen|bullet train|steam engine\b/i, 'train'],
    [/\bgalleon|cruise ship|sloop|speedboat|submarine\b/i, 'ship'],
    [/\bhighrise|tower block\b/i, 'skyscraper'],
    [/\bcottage|cabin|bungalow|villa|treehouse\b/i, 'house'],
    [/\bcitadel|bastion\b/i, 'castle'],
    [/\bshrine|cathedral|mosque|church|monastery|synagogue\b/i, 'pagoda'],
    [/\bbeacon tower\b/i, 'lighthouse'],
    [/\bsuspension bridge|viaduct|aqueduct|arch bridge\b/i, 'bridge'],
    [/\bziggurat|mausoleum\b/i, 'pyramid'],
    [/\bwater mill|pinwheel\b/i, 'windmill'],
    [/\bobservation wheel|carousel|merry go round\b/i, 'ferrisWheel'],
    [/\bobelisk|eiffel tower|tower of pisa|totem pole|memorial|statue\b/i, 'monument'],
    [/\blongsword|broadsword|rapier|scimitar|claymore\b/i, 'sword'],
    [/\bhalberd|mace|warhammer|cleaver|hatchet\b/i, 'axe'],
    [/\barmchair|throne|rocking chair|office chair\b/i, 'chair'],
    [/\bworkbench|coffee table|dining table\b/i, 'table'],
    [/\bloveseat|sectional\b/i, 'sofa'],
    [/\bbunk bed|four poster|hammock\b/i, 'bed'],
    [/\blantern|torch|candle\b/i, 'lamp'],
    [/\bviolin|cello|harp|ukulele|lute\b/i, 'guitar'],
    [/\bpocket watch|grandfather clock|hourglass|big ben\b/i, 'clock'],
    [/\bmedal|grail|chalice|urn|vase\b/i, 'trophy'],
    [/\btiara|circlet\b/i, 'crown'],
    [/\blocker|suitcase|chest|safe\b/i, 'crate'],
    [/\bdoughnut|bagel|pizza|pancake|hamburger|burger|cupcake|cookie\b/i, 'donut'],
    [/\btoadstool|fungus\b/i, 'mushroom'],
    [/\bsucculent|aloe\b/i, 'cactus'],
    [/\brose|tulip|sunflower|daisy|lotus|orchid|bonsai|fern\b/i, 'flower'],
    [/\bwillow|maple|birch|palm|evergreen|christmas tree|fir\b/i, 'conifer'],
  ];

  /* ---------- regex addons → spec detail keys ---------- */
  const ADDON_TO_DETAIL = {
    wings: 'wings', horns: 'horns', spikes: 'spikesBack', tail: 'tailAddon',
    wheels: 'wheelsExtra', treads: 'treads', cannon: 'cannon', antenna: 'antennaPair',
    dome: 'domeShell', towers: 'towerCountAdd', flags: 'flags', crest: 'crest',
    armor: 'armorPlates', gloweyes: 'glowEyes', claws: 'clawTips', jets: 'jets',
  };

  /* =========================================================
   * FACT PARSING — pull real-world ratios out of Knowledge.FACTS
   * so specs carry evidence-backed numbers.
   * ======================================================= */
  function parseFactRatios(text) {
    const out = [];
    const src = (typeof Knowledge !== 'undefined' && Knowledge.FACTS) ? Knowledge.FACTS : [];
    const q = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    for (const fact of src) {
      const hay = (fact.topic + ' ' + fact.body + ' ' + (fact.tags || []).join(' ')).toLowerCase();
      let s = 0;
      for (const w of q) {
        if (hay.includes(w)) s++;
        if ((fact.tags || []).some(t => String(t).includes(w))) s += 1.5;
      }
      if (s < 2) continue;
      const b = fact.body;
      // "X ≈ Y% of Z" or "X is Y% of Z"
      let m;
      const pctRe = /([a-zøø][a-z ]{2,28}?)\s*(?:≈|is|:|=|\(approx\.?\)?\s*)?\s*(?:≈\s*)?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s*)?([a-zøø ]{2,28})/gi;
      while ((m = pctRe.exec(b))) {
        out.push({ kind: 'percent', target: m[1].trim(), pct: parseFloat(m[2]) / 100, of: m[3].trim(), topic: fact.topic });
      }
      const mulRe = /([a-z][a-z ]{2,28}?)\s*(?:≈|is|=|:)?\s*(\d+(?:\.\d+)?)×\s*([a-z][a-z ]{2,24})/gi;
      while ((m = mulRe.exec(b))) {
        out.push({ kind: 'multiple', target: m[1].trim(), factor: parseFloat(m[2]), of: m[3].trim(), topic: fact.topic });
      }
      const ratioRe = /([a-z][a-z ]{2,24}?)\s*(?:ratio|:)\s*(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/gi;
      while ((m = ratioRe.exec(b))) {
        out.push({ kind: 'ratio', target: m[1].trim(), a: parseFloat(m[2]), b: parseFloat(m[3]), topic: fact.topic });
      }
    }
    return out.slice(0, 12);
  }

  /* map parsed ratios onto spec params (best-effort semantic binding) */
  function bindRatios(spec, ratios) {
    const notes = [];
    const d = spec.detail;
    const find = (kwRe) => ratios.find(r => kwRe.test(r.target + ' ' + (r.of || '')));
    let r;
    if ((r = find(/head.*height|height.*head/i))) {
      const f = clamp(r.pct * 8, 0.6, 2.2); // canon 8-heads baseline
      d.headScale = round3(clamp((d.headScale || 1) * (f / 1.0), 0.5, 2));
      notes.push(`head ≈ ${(r.pct * 100).toFixed(0)}% of height (${r.topic})`);
    }
    if ((r = find(/leg.*height|height.*leg/i))) {
      d.legScale = round3(clamp((d.legScale || 1) * (r.pct / 0.48), 0.5, 2.2));
      notes.push(`leg length ≈ ${(r.pct * 100).toFixed(0)}% of body height (${r.topic})`);
    }
    if ((r = find(/shoulder span|span.*heads/i))) {
      d.wideStance = round3(clamp((d.wideStance || 1) * (r.pct * 4), 0.7, 1.8));
      notes.push(`shoulder span ratio applied (${r.topic})`);
    }
    if ((r = find(/wingspan/i)) && r.kind === 'multiple') {
      d.wingSpanMul = round3(clamp((d.wingSpanMul || 1) * (r.factor / 2.5), 0.7, 2.2));
      notes.push(`wingspan ≈ ${r.factor}× body (${r.topic})`);
    }
    if ((r = find(/tail.*length|length.*tail/i))) {
      d.tailLen = round3(clamp((d.tailLen || 1) * (r.pct / 0.4), 0.5, 2.4));
      notes.push(`tail ≈ ${(r.pct * 100).toFixed(0)}% of total length (${r.topic})`);
    }
    if ((r = find(/width:height|height/i)) && r.kind === 'ratio') {
      d.heightStretch = round3(clamp(r.b / r.a / 7, 0.6, 2.4));
      notes.push(`slenderness ${r.a}:${r.b} (${r.topic})`);
    }
    if ((r = find(/seat height|seat/i))) {
      d.seatHeight = round3(clamp(r.pct * 1.6, 0.3, 1.2));
      notes.push(`seat ergonomics reference (${r.topic})`);
    }
    spec.factNotes = notes.slice(0, 6);
  }

  /* =========================================================
   * MAIN ENTRY — resolve(prompt, plan) → spec
   * ========================================================= */
  function resolve(prompt, plan) {
    const text = String(prompt || '');
    const spec = {
      subject: null, label: null, arch: plan ? plan.archetype : null,
      detail: {}, palette: {}, materials: {}, dims: {},
      paramOps: [], factNotes: [], confidence: plan ? plan.semantic : 0.8,
      reasons: [],
    };
    const d = spec.detail;

    /* ---- 1. subject identification (most specific match wins) ---- */
    let bestKey = null, bestScore = 0;
    const lower = text.toLowerCase();
    for (const [key, sub] of Object.entries(SUBJECTS)) {
      if (!sub || !sub.kw) continue;
      for (const kw of sub.kw) {
        if (!kw) continue;
        const re = new RegExp('\\b' + kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        const m = re.exec(text);
        if (m) {
          const lenScore = kw.trim().split(/\s+/).length * 2 + m[0].length * 0.05;
          if (lenScore > bestScore) { bestScore = lenScore; bestKey = key; }
        }
      }
    }
    for (const [re, key] of EXTRA_ROUTES) {
      if (re.test(text) && SUBJECTS[key]) {
        // routes score just below direct multi-word keyword matches
        if (bestScore < 4) { bestKey = key; bestScore = Math.max(bestScore, 3); }
      }
    }
    if (bestKey) {
      const sub = SUBJECTS[bestKey];
      spec.subject = bestKey;
      spec.label = bestKey.replace(/_/g, ' ');
      const chain = [];
      if (sub.via && SUBJECTS[sub.via]) chain.push(SUBJECTS[sub.via]);
      chain.push(sub);
      for (const c of chain) {
        mergeDeep(d, c.d || {});
        if (c.arch) spec.arch = c.arch;
      }
      spec.reasons.push(`subject “${spec.label}” matched corpus entry → archetype ${spec.arch}`);
    }

    /* ---- 2. numeric phrases ---- */
    for (const cp of COUNT_PATTERNS) {
      const m = cp.re.exec(text);
      if (!m) continue;
      const grab = m[1] !== undefined ? m[1] : m[0].match(/\d+|[a-z]+/i)?.[0];
      let n = /^\d+$/.test(grab) ? parseInt(grab, 10) : (NUM_WORDS[String(grab).toLowerCase()] || null);
      if (n == null) continue;
      n *= (cp.mul || 1);
      const keyMap = { earCount: 'earCount', wingCount: 'wingCount', hornCount: 'hornCount', legCount: 'legCount', floors: 'floorsHint', towerCount: 'towerCount', eyeCount: 'eyeCount', tailCount: 'tailCount' };
      d[keyMap[cp.set]] = n;
      spec.reasons.push(`${cp.set} = ${n} from explicit count “${m[0]}”`);
    }

    /* ---- 3. adjectives ---- */
    for (const rule of ADJ_RULES) {
      if (!rule.re.test(text)) continue;
      if (rule.set) {
        for (const [k, v] of Object.entries(rule.set)) d[k] = v;
      } else if (rule.mul) {
        for (const [k, v] of Object.entries(rule.mul)) d[k] = round3((d[k] || 1) * v);
      }
    }
    /* ---- 3b. explicit phrase overrides (win over generic adjectives) ---- */
    const direct = [
      [/\blong\s+neck\b/i, 'neckLong', 1.7], [/\blong\s+ears?\b/i, 'earMode', 'longEars'],
      [/\blong\s+tail\b/i, 'tailLen', 1.6], [/\blong\s+snout\b|\b elongated\s+muzzle/i, 'snoutMul', 1.4],
      [/\blong\s+(?:legs?|limbs?)\b/i, 'legScale', 1.3], [/\blong\s+body\b/i, 'bodyLen', 1.3],
      [/\blong\s+hair\b/i, 'furLong', 1], [/\blong\s+robe\b/i, 'robeFlare', 1],
      [/\bshort\s+legs?\b/i, 'legScale', 0.7], [/\bshort\s+tail\b/i, 'tailShort', 1],
      [/\bshort\s+ears?\b/i, 'earMode', 'roundEars'], [/\bshort\s+neck\b/i, 'neckLong', 0.7],
    ];
    for (const [re, k, v] of direct) if (re.test(text)) { d[k] = typeof v === 'number' && typeof d[k] === 'number' ? round3(d[k] * v) : v; }

    /* ---- 4. explicit dimensions ---- */
    const unitM = { m: 1, meter: 1, meters: 1, metre: 1, ft: 0.3048, foot: 0.3048, feet: 0.3048, cm: 0.01, mm: 0.001, in: 0.0254, inch: 0.0254, inches: 0.0254 };
    let dm;
    const dimRe = /(\d+(?:\.\d+)?)\s*(meters?|metres?|m|cm|mm|ft|feet|foot|inches|inch|in)(?![a-z])/gi;
    const dims = [];
    while ((dm = dimRe.exec(text))) {
      const u = dm[2].toLowerCase();
      dims.push({ raw: dm[0], value: parseFloat(dm[1]), meters: +(parseFloat(dm[1]) * (unitM[u] || 1)).toFixed(3) });
    }
    if (dims.length) {
      const maxM = Math.max(...dims.map(x => x.meters));
      spec.dims.requested = dims.slice(0, 4);
      // scene canonical height ~1.6 units ⇒ convert requested max extent to global scale
      spec.dims.scaleFromDims = clamp(maxM / 1.6, 0.25, 6);
      spec.reasons.push(`explicit size “${dims[0].raw}” → world scale ×${spec.dims.scaleFromDims.toFixed(2)}`);
    }
    const relScale = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|times)\s*(?:bigger|larger|scale|size)/i);
    if (relScale) spec.dims.relScale = parseFloat(relScale[1]);
    const relDown = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|times)\s*(?:smaller|tinier)/i);
    if (relDown) spec.dims.relScale = 1 / parseFloat(relDown[1]);

    /* ---- 5. size words ---- */
    for (const sz of SIZE_HINTS) {
      if (sz.re.test(text)) { spec.sizeMul = sz.s; spec.reasons.push(`size cue “${sz.re.source.split('|')[0]}” → ×${sz.s}`); break; }
    }

    /* ---- 6. palette: named colors + patterns ---- */
    const colHits = [];
    for (const [w, hex] of Object.entries(COLOR_WORDS)) {
      const re = new RegExp('\\b' + w + '\\b', 'i');
      const m = re.exec(text);
      if (m) colHits.push({ word: w, hex, idx: m.index });
    }
    colHits.sort((a, b) => a.idx - b.idx);
    if (colHits.length) {
      spec.palette.primary = colHits[0].hex;
      spec.palette._named = colHits[0].word;
      if (colHits.length > 1) {
        spec.palette.secondary = colHits[1].hex;
        // "<color> X with <color2> Y" — assign second color by proximity to noun
        const i2 = text.toLowerCase().indexOf(colHits[1].word);
        const near = text.slice(Math.max(0, i2 - 24), i2 + colHits[1].word.length + 24).toLowerCase();
        if (/wing|cape|cloak|robe|panel|stripe|accent|trim|marking/.test(near)) spec.palette.accent = colHits[1].hex;
        else if (/leg|arm|limb|boot|paw/.test(near)) spec.palette.limb = colHits[1].hex;
        else if (/base|ground|wheel|tire|track|dark|shadow/.test(near)) spec.palette.dark = colHits[1].hex;
        else if (/metal|chrome|steel|joint|pipe|hinge/.test(near)) spec.palette.metal = colHits[1].hex;
        else spec.palette.accent = colHits[1].hex;
      }
      if (colHits.length > 2) spec.palette.glow = colHits[2].hex;
      spec.reasons.push(`palette from named colors: ${colHits.map(c => c.word).join(', ')}`);
    }
    for (const pat of PATTERNS) {
      if (pat.re.test(text)) {
        const p = {}; pat.apply(p);
        for (const [k, v] of Object.entries(p)) {
          if (k.startsWith('__')) continue;
          if (k === '_stripes') { d.stripes = 1; continue; }
          if (k === '_spots') { d.spots = 1; continue; }
          if (k === 'emissive') { spec.materials.emissive = v; continue; }
          if (k === 'rough') { spec.materials.roughnessBias = v; continue; }
          if (k === 'rust') { d.rustPatches = v; continue; }
          if (k === 'glass') { spec.palette.glass = v; continue; }
          if (!(k in spec.palette)) spec.palette[k] = v;
          else if (k === 'primary' && spec.palette._namedLocked) { /* user explicit wins */ }
        }
        spec.reasons.push(`pattern/finish “${pat.re.source}” recognized`);
      }
    }
    if (/\bwith\s+(?:a\s+)?(?:red|blue|green|gold|silver|black|white)\s+(?:wings?|cape|cloak|crest|mane|tail|visor|eyes?)\b/i.test(text)) {
      spec.reasons.push('secondary feature color bound to nearest noun');
    }

    /* ---- 7. materials ---- */
    for (const mat of MATERIALS) {
      if (mat.re.test(text)) {
        spec.materials.matched = spec.materials.matched || [];
        spec.materials.matched.push(mat.re.source);
        spec.materials.metalnessBias = (spec.materials.metalnessBias || 0) + (mat.m.metalness || 0);
        spec.materials.roughnessBias = (spec.materials.roughnessBias || 0) + (mat.m.roughness || 0);
        spec.materials.emissiveBias = (spec.materials.emissiveBias || 0) + (mat.m.emissive || 0);
        if (mat.m.tint) Object.assign(spec.palette, mat.m.tint);
      }
    }

    /* ---- 8. regex addon lexicon results → detail keys ---- */
    if (plan && plan.addons) {
      for (const a of plan.addons) {
        const dk = ADDON_TO_DETAIL[a];
        if (dk && !(dk in d)) d[dk] = a === 'towers' ? 4 : 1;
      }
    }

    /* ---- 9. subject-default palettes when user gave none ---- */
    const SUBJECT_DEFAULT_COLORS = {
      wolf: { primary: '#9aa4b0', secondary: '#6e7683', accent: '#e8e8ec', dark: '#2b2f36' },
      fox: { primary: '#d9622b', secondary: '#f3e9d2', accent: '#1a1d24' },
      lion: { primary: '#d9a441', secondary: '#b07f2a', accent: '#7a4a21' },
      tiger: { primary: '#e08b2e', secondary: '#2b2118', accent: '#f3e9d2' },
      panda: null,
      bear: { primary: '#6e5138', secondary: '#54402d' },
      horse: { primary: '#7a5230', secondary: '#3a2a18', accent: '#241a10' },
      zebra: { primary: '#e8e8ec', secondary: '#1a1d24' },
      giraffe: { primary: '#e0b34a', secondary: '#8a6a20' },
      elephant: { primary: '#9aa0ab', secondary: '#7c828d' },
      rabbit: { primary: '#cfd4db', secondary: '#a9b0bb', accent: '#f2b8c6' },
      cat: { primary: '#8b95a5', secondary: '#5c6470' },
      dog: { primary: '#a9743f', secondary: '#6e4a26' },
      trex: { primary: '#7f8f5a', secondary: '#55603c', accent: '#e0dfa6' },
      raptor: { primary: '#a8763e', secondary: '#4f5d3a', accent: '#ffd166' },
      dragon: { primary: '#b03030', secondary: '#6e1c1c', accent: '#ffb454', glow: '#ff5a1f' },
      snake: { primary: '#5f8f4e', secondary: '#37502e', accent: '#d9ed92' },
      crocodile: { primary: '#4f6f4a', secondary: '#31452f' },
      shark: { primary: '#7c8ea0', secondary: '#dfe6ee' },
      whale: { primary: '#3f5876', secondary: '#dfe6ee' },
      penguin: { primary: '#1a1d24', secondary: '#eef2f7' },
      owl: { primary: '#8a6f4d', secondary: '#5c4a33', accent: '#ffd166' },
      eagle: { primary: '#5a4632', secondary: '#e8e2d5', accent: '#d4af37' },
      parrot: { primary: '#e5484d', secondary: '#3b82f6', accent: '#ffd233' },
      flamingo: null,
      bat: { primary: '#3a3f47', secondary: '#22262e', accent: '#8b5cf6' },
      castle: { primary: '#b8a68a', secondary: '#8f8268', accent: '#7a2f2f' },
      house: { primary: '#d8c8a8', secondary: '#8a5a3b', accent: '#3dd68c' },
      skyscraper: { primary: '#9fb6cc', secondary: '#5c7a94', glass: '#bfe8ff' },
      pyramid: { primary: '#d8c08a', secondary: '#b39a63' },
      lighthouse: { primary: '#e8e8ec', secondary: '#e5484d' },
      rocket: { primary: '#eef2f7', secondary: '#c0c7d1', accent: '#e5484d', glow: '#ff8c1a' },
      fighterJet: { primary: '#7f8fa3', secondary: '#5b6a80', accent: '#22d3ee' },
      airliner: { primary: '#e8edf3', secondary: '#3b82f6' },
      helicopter: { primary: '#3f5843', secondary: '#2c3d30' },
      sportsCar: { primary: '#e5484d', secondary: '#1a1d24', accent: '#c0c7d1' },
      truck: { primary: '#3b82f6', secondary: '#26508a' },
      bus: { primary: '#ffd233', secondary: '#1a1d24' },
      tank: { primary: '#6b7f35', secondary: '#4a5827', dark: '#2f3540' },
      motorcycle: { primary: '#1a1d24', secondary: '#c0c7d1' },
      train: { primary: '#2f3540', secondary: '#8b95a5', accent: '#d4af37' },
      ship: { primary: '#8a5a3b', secondary: '#5f3b21', accent: '#eef2f7' },
      ufo: { primary: '#c0c7d1', secondary: '#8b95a5', glow: '#37e0b0' },
      drone: { primary: '#2b3446', secondary: '#14161c', glow: '#22d3ee' },
      robot: { primary: '#c0c7d1', secondary: '#8b95a5', glow: '#37e0b0' },
      mech: { primary: '#4db8ff', secondary: '#2b3446', accent: '#ffb454' },
      knight: { primary: '#c0c7d1', secondary: '#8b95a5', accent: '#7a2f2f' },
      wizard: { primary: '#4f46e5', secondary: '#2e2a72', accent: '#ffd233' },
      samurai: { primary: '#7a2f2f', secondary: '#1a1d24', accent: '#d4af37' },
      superhero: { primary: '#3b82f6', secondary: '#1e3a8a', accent: '#ffd233' },
      pirate: { primary: '#1a1d24', secondary: '#8a5a3b', accent: '#e5484d' },
      ninja: { primary: '#14161c', secondary: '#2b3446', accent: '#8b95a5' },
      vampire: { primary: '#1a1d24', secondary: '#7a2f2f', accent: '#eef2f7' },
      ghost: { primary: '#dfe6ee', secondary: '#b9c4d0' },
      angel: { primary: '#f3f6fa', secondary: '#d4af37' },
      demon: { primary: '#b03030', secondary: '#1a1d24', glow: '#ff5a1f' },
      skeleton: { primary: '#e8e2d5', secondary: '#c9c2b2' },
      zombie: { primary: '#6e7f5a', secondary: '#4a5440' },
      mummy: { primary: '#e2cfa5', secondary: '#b39a63', accent: '#d4af37' },
      goblin: { primary: '#5f8f4e', secondary: '#3c5a30' },
      yeti: { primary: '#eef2f7', secondary: '#cfd8e3' },
      mermaid: { primary: '#22d3ee', secondary: '#1ba774', accent: '#f472b6' },
      phoenix: { primary: '#ff8c1a', secondary: '#e5484d', glow: '#ffb01f' },
      griffin: { primary: '#d9a441', secondary: '#8a6a20', accent: '#eef2f7' },
      pegasus: { primary: '#eef2f7', secondary: '#c9d3de', accent: '#b3a1e6' },
      unicorn: { primary: '#f3f0fa', secondary: '#d8d2ea', accent: '#e879f9' },
      guitar: { primary: '#8a5a3b', secondary: '#5f3b21', accent: '#d4af37' },
      sword: { primary: '#c9d3de', secondary: '#8b95a5', accent: '#d4af37' },
      axe: { primary: '#8b95a5', secondary: '#6e4a26' },
      chair: { primary: '#8a5a3b', secondary: '#5f3b21' },
      table: { primary: '#a9743f', secondary: '#6e4a26' },
      sofa: { primary: '#7a5fa0', secondary: '#573f7a' },
      bed: { primary: '#c9a06b', secondary: '#eef2f7' },
      lamp: { primary: '#d4af37', secondary: '#8b95a5', glow: '#ffd233' },
      clock: { primary: '#8a5a3b', secondary: '#d4af37' },
      crown: { primary: '#d4af37', secondary: '#a8842a', accent: '#3b82f6' },
      trophy: { primary: '#d4af37', secondary: '#b3902a' },
      crate: { primary: '#a9743f', secondary: '#7a5230' },
      donut: { primary: '#e8829a', secondary: '#d8a86b' },
      mushroom: { primary: '#e5484d', secondary: '#f3e9d2' },
      cactus: { primary: '#3dd68c', secondary: '#2b7a3d' },
      flower: { primary: '#f472b6', secondary: '#3dd68c', accent: '#ffd233' },
      tree_oak: { primary: '#7fb069', secondary: '#4a3f35' },
      snowman: { primary: '#f2f4f8', secondary: '#1a1d24', accent: '#e5484d' },
      pagoda: { primary: '#b03030', secondary: '#6e1c1c', accent: '#d4af37' },
      bridge: { primary: '#8b95a5', secondary: '#5c6470', accent: '#a0522d' },
      monument: { primary: '#cfc6b8', secondary: '#9b938a' },
      windmill: { primary: '#e2cfa5', secondary: '#8a5a3b', accent: '#eef2f7' },
      ferrisWheel: { primary: '#e5484d', secondary: '#c0c7d1', accent: '#ffd233' },
      frog: { primary: '#3dd68c', secondary: '#2b7a3d' },
      turtle: { primary: '#5f8f4e', secondary: '#8a6a20' },
      octopus: { primary: '#a855f7', secondary: '#7a3bb0' },
      crab: { primary: '#e5484d', secondary: '#a33236' },
      mouse: { primary: '#b9c0cb', secondary: '#8b95a5', accent: '#f472b6' },
      squirrel: { primary: '#b06a30', secondary: '#7a4a21' },
      monkey: { primary: '#8a6a4a', secondary: '#5c4632' },
      cow: { primary: '#e8e8ec', secondary: '#1a1d24' },
      goat: { primary: '#d8cfc2', secondary: '#8f8577' },
      pig: { primary: '#f2b8c6', secondary: '#d18ea1' },
      deer: { primary: '#a9743f', secondary: '#6e4a26', accent: '#f3e9d2' },
      camel: { primary: '#c9a06b', secondary: '#a37c46' },
      kangaroo: { primary: '#a3714a', secondary: '#7a5230' },
      triceratops: { primary: '#8a7f5c', secondary: '#5c5340', accent: '#d9a441' },
      dove: { primary: '#dfe6ee', secondary: '#b9c4d0', accent: '#37e0b0' },
      chicken: { primary: '#eef2f7', secondary: '#d4af37', accent: '#e5484d' },
      ship_: null,
    };
    const sd = SUBJECT_DEFAULT_COLORS[bestKey];
    if (sd) {
      for (const [k, v] of Object.entries(sd)) {
        if (k === 'primary' && spec.palette._named) continue; // user color wins
        if (!(k in spec.palette)) spec.palette[k] = v;
      }
      if (!spec.palette._named && sd.primary) spec.reasons.push(`species-typical palette applied (${bestKey})`);
    }

    /* ---- 10. real-world ratio binding ---- */
    try {
      const ratios = parseFactRatios(text + ' ' + (spec.label || '') + ' ' + (spec.arch || '').replace(/_/g, ' '));
      bindRatios(spec, ratios);
      if (spec.factNotes.length) spec.reasons.push('fact-bound: ' + spec.factNotes.join('; '));
    } catch (e) { /* non-fatal */ }

    /* ---- 11. confidence boost: a resolved subject means we KNOW the form ---- */
    if (spec.subject) {
      spec.confidence = clamp(Math.max(spec.confidence || 0.8, 0.9) + Math.min(0.06, bestScore * 0.01), 0, 0.995);
    }
    if (Object.keys(spec.dims).length) spec.confidence = clamp(spec.confidence + 0.02, 0, 0.995);
    if (spec.palette._named) spec.confidence = clamp(spec.confidence + 0.015, 0, 0.995);

    return spec;
  }

  window.Fidelity = { resolve, COLOR_WORDS, SUBJECTS, clamp, clone };
})();
