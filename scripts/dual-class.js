/**
 * PF2e Awesome Variant Rules: Dual Class Variant Rule
 *
 * Implements the Pathfinder 2e Dual-Class PCs variant rule (Gamemastery Guide / GM Core)
 * natively on the PF2e Character Sheet without generating cluttered merged custom class items.
 *
 * Core Mechanics (per official PF2e Dual-Class rules):
 * - Second Class field directly on the character sheet (supports drag-and-drop & searchable picker).
 * - Hit Points: Uses the HIGHER HP per level between both classes (never summed).
 * - Saving Throws, Perception, Weapon/Armor Proficiencies, Spellcasting:
 *   Uses the HIGHEST initial rank from either class, with all level-up class features from
 *   both classes upgrading proficiencies natively via PF2e's Rule Element engine.
 * - Key Attribute Boosts: Grants the 1st-level key attribute boost from BOTH classes
 *   (cannot stack two class boosts onto the same attribute unless optional house rule is enabled;
 *   respects PF2e's level-1 +4 cap, partial boosts above +4, and Apex items).
 * - Starting Skills: Grants automatic trained skills from BOTH classes, and tracks the
 *   HIGHER number of additional trained skills.
 * - Class DCs: Tracks a separate Class DC for each class using its respective key attribute.
 * - Class Feats: Adds a native Dual Class feat slot group right below Class Feats using the
 *   second class's exact classFeatLevels and pre-filtered Compendium Browser traits.
 * - Shared Progression: Merges unique extra skill/general/ancestry feat levels (e.g., Rogue /
 *   Investigator every-level skill feats) without doubling standard shared levels.
 * - Class Features: Auto-grants second-class features on selection and on every level up,
 *   deduplicates identical shared features (e.g., Weapon Specialization, Shield Block),
 *   and cleanly removes features on level down or class removal.
 */

const MODULE_ID = "pf2e-awesome-variant-rules";
const FLAG_KEY = "dualClass";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = {
    str: "STR",
    dex: "DEX",
    con: "CON",
    int: "INT",
    wis: "WIS",
    cha: "CHA"
};
const RANK_LABELS = ["U", "T", "E", "M", "L"];
const RANK_FULL_LABELS = ["Untrained", "Trained", "Expert", "Master", "Legendary"];

/**
 * Mapping from legacy 3-letter PF2e skill abbreviations to modern full skill slugs.
 */
const LEGACY_SKILL_MAP = {
    acr: "acrobatics",
    arc: "arcana",
    ath: "athletics",
    cra: "crafting",
    dec: "deception",
    dip: "diplomacy",
    itm: "intimidation",
    med: "medicine",
    nat: "nature",
    occ: "occultism",
    prf: "performance",
    rel: "religion",
    soc: "society",
    ste: "stealth",
    sur: "survival",
    thi: "thievery"
};

/**
 * Shared PF2e classfeature slugs that never stack when granted by both classes.
 * Primary deduplication checks compendium source UUID first; this set catches
 * legacy/remaster variants that share the same mechanical feature slug.
 */
const NON_STACKING_FEATURE_SLUGS = new Set([
    "weapon-specialization",
    "greater-weapon-specialization",
    "shield-block",
    "alertness",
    "perception-expertise",
    "perception-mastery",
    "vigilant-senses",
    "incredible-senses",
    "evasion",
    "improved-evasion",
    "juggernaut",
    "resolve",
    "greater-resolve",
    "lightning-reflexes",
    "great-fortitude",
    "iron-will",
    "reflex-expertise",
    "fortitude-expertise",
    "will-expertise",
    "light-armor-expertise",
    "medium-armor-expertise",
    "heavy-armor-expertise",
    "unarmored-defense-expertise",
    "armor-expertise",
    "armor-mastery",
    "weapon-expertise",
    "weapon-mastery",
    "canny-acumen"
]);

/** Per-actor async lock to prevent duplicate feature syncs during rapid updates */
const syncingActors = new Set();

/** Guard flags to avoid wrapping prototypes more than once */
let wrappersInstalled = false;
let featsPrototypeWrapped = false;

/* ------------------------------------------------------------------------- */
/* 1. SETTINGS REGISTRATION                                                  */
/* ------------------------------------------------------------------------- */

export function registerDualClassSettings() {
    game.settings.register(MODULE_ID, "dualClassEnabled", {
        name: "Enable Dual Class Variant Rule",
        hint: "Adds a Second Class slot to PF2e character sheets. Automatically combines HP (higher value), saving throws, Perception, weapon/armor proficiencies, trained skills, key attribute boosts, class DCs, class feat slots, and auto-grants second-class features on level up.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            refreshAllCharacterActors();
        }
    });

    game.settings.register(MODULE_ID, "dualClassAutoGrantFeatures", {
        name: "Dual Class: Auto-Grant Class Features on Level Up",
        hint: "Automatically adds newly unlocked second-class features when leveling up (and removes higher-level ones if leveling down).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "dualClassAllowSharedKeyAlternative", {
        name: "Dual Class: Allow Alternative Boost on Shared Key Attribute",
        hint: "House rule option: By raw PF2e rules, if both classes have the exact same key attribute (e.g., Sorcerer + Bard), you cannot apply both class boosts to it. Enable this to allow choosing a different attribute for the second class boost instead.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            refreshAllCharacterActors();
        }
    });
}

export function isDualClassEnabled() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "dualClassEnabled"));
    } catch {
        return false;
    }
}

export function isAutoGrantFeaturesEnabled() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "dualClassAutoGrantFeatures"));
    } catch {
        return true;
    }
}

export function isSharedKeyAlternativeAllowed() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "dualClassAllowSharedKeyAlternative"));
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------------- */
/* 2. DATA ACCESSORS & HELPERS                                               */
/* ------------------------------------------------------------------------- */

/**
 * Retrieve the stored secondary class flag payload for a character actor.
 * @param {Actor} actor
 * @returns {object|null}
 */
export function getSecondaryClassData(actor) {
    if (!actor || actor.type !== "character") return null;
    const data = actor.getFlag(MODULE_ID, FLAG_KEY);
    if (!data || !data.itemData) return null;
    return data;
}

/**
 * Normalize a class slug from itemData or name.
 * @param {object} itemData
 * @returns {string}
 */
function getClassSlug(itemData) {
    if (!itemData) return "";
    const raw = itemData.system?.slug || itemData.slug || itemData.name || "";
    return String(raw)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Normalize a skill key to PF2e's full slug name.
 * @param {string} skill
 * @returns {string}
 */
function normalizeSkillSlug(skill) {
    const key = String(skill || "").toLowerCase().trim();
    return LEGACY_SKILL_MAP[key] || key;
}

/**
 * Extract valid key ability options from a PF2e class itemData.
 * Handles both `{ value: ["str", "dex"] }` and direct array formats.
 * @param {object} classSystem
 * @returns {string[]}
 */
function extractKeyAbilityOptions(classSystem) {
    const raw = classSystem?.keyAbility?.value ?? classSystem?.keyAbility ?? classSystem?.keyAttribute ?? [];
    const list = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
    return list
        .map(a => String(a).toLowerCase().trim())
        .filter(a => ABILITY_KEYS.includes(a));
}

/**
 * Extract a numeric level array from PF2e class progression fields
 * (e.g. `classFeatLevels`, `skillFeatLevels`, `generalFeatLevels`, `ancestryFeatLevels`).
 * @param {object} field
 * @returns {number[]}
 */
function extractLevelArray(field) {
    const raw = Array.isArray(field) ? field : (Array.isArray(field?.value) ? field.value : []);
    return raw
        .map(v => Number(v))
        .filter(n => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
}

/**
 * Determine the actor's primary class key attribute.
 * @param {Actor} actor
 * @returns {string|null}
 */
function getPrimaryKeyAbility(actor) {
    const val = actor?.system?.details?.keyability?.value
        ?? actor?.system?.build?.attributes?.boosts?.class
        ?? extractKeyAbilityOptions(actor?.class?.system)[0]
        ?? null;
    return val && ABILITY_KEYS.includes(val) ? val : null;
}

/**
 * Resolve the effective key attribute boost details for the secondary class.
 * @param {Actor} actor
 * @param {object|null} [dualData]
 * @returns {{
 *   selected: string|null,
 *   options: string[],
 *   primaryKey: string|null,
 *   isSharedWithPrimary: boolean,
 *   effectiveBoostAttribute: string|null,
 *   allowAlternative: boolean
 * }}
 */
export function getSecondaryClassKeyAbility(actor, dualData = null) {
    const data = dualData ?? getSecondaryClassData(actor);
    if (!data?.itemData) {
        return {
            selected: null,
            options: [],
            primaryKey: getPrimaryKeyAbility(actor),
            isSharedWithPrimary: false,
            effectiveBoostAttribute: null,
            allowAlternative: false
        };
    }

    const primaryKey = getPrimaryKeyAbility(actor);
    const options = extractKeyAbilityOptions(data.itemData.system);
    const allowAlternative = isSharedKeyAlternativeAllowed();

    // Stored player selection for secondary class key attribute
    let selected = data.keyAbility && ABILITY_KEYS.includes(data.keyAbility) ? data.keyAbility : null;

    // Default to an option that doesn't collide with primaryKey if available
    if (!selected || (!allowAlternative && options.length > 0 && !options.includes(selected))) {
        selected = options.find(opt => opt !== primaryKey) ?? options[0] ?? null;
    }

    // Class DC attribute always uses a valid class key ability option (even if shared with primary)
    const classDCAttribute = (selected && options.includes(selected))
        ? selected
        : (options[0] ?? selected ?? "str");

    const isSharedWithPrimary = Boolean(selected && primaryKey && selected === primaryKey);

    // If house rule allows picking an alternate attribute when classes share the same single key attribute
    let effectiveBoostAttribute = null;
    if (!isSharedWithPrimary && selected) {
        effectiveBoostAttribute = selected;
    } else if (isSharedWithPrimary && allowAlternative && data.altBoostAbility && ABILITY_KEYS.includes(data.altBoostAbility) && data.altBoostAbility !== primaryKey) {
        effectiveBoostAttribute = data.altBoostAbility;
    }

    return {
        selected,
        classDCAttribute,
        options,
        primaryKey,
        isSharedWithPrimary,
        effectiveBoostAttribute,
        allowAlternative
    };
}

/**
 * Compute a complete Dual Class comparison & summary object for UI tooltips and API consumers.
 * @param {Actor} actor
 * @returns {object|null}
 */
export function getDualClassSummary(actor) {
    const dualData = getSecondaryClassData(actor);
    if (!dualData?.itemData) return null;

    const primary = actor.class;
    const pSys = primary?.system ?? {};
    const sSys = dualData.itemData.system ?? {};

    const primaryName = primary?.name ?? "None";
    const secondaryName = dualData.itemData.name ?? "Second Class";
    const secondarySlug = getClassSlug(dualData.itemData);

    const primaryHp = Number(pSys.hp ?? 0);
    const secondaryHp = Number(sSys.hp ?? 0);
    const effectiveHp = Math.max(primaryHp, secondaryHp);

    const saves = {};
    for (const save of ["fortitude", "reflex", "will"]) {
        const pRank = Number(pSys.savingThrows?.[save] ?? 0);
        const sRank = Number(sSys.savingThrows?.[save] ?? 0);
        saves[save] = {
            primary: pRank,
            secondary: sRank,
            effective: Math.max(pRank, sRank)
        };
    }

    const pPerc = Number(pSys.perception ?? 0);
    const sPerc = Number(sSys.perception ?? 0);
    const perception = {
        primary: pPerc,
        secondary: sPerc,
        effective: Math.max(pPerc, sPerc)
    };

    const pAddSkills = Number(pSys.trainedSkills?.additional ?? 0);
    const sAddSkills = Number(sSys.trainedSkills?.additional ?? 0);
    const additionalSkills = {
        primary: pAddSkills,
        secondary: sAddSkills,
        effective: Math.max(pAddSkills, sAddSkills),
        source: sAddSkills > pAddSkills ? secondaryName : primaryName
    };

    const autoTrainedSkills = (sSys.trainedSkills?.value ?? []).map(normalizeSkillSlug);
    const keyInfo = getSecondaryClassKeyAbility(actor, dualData);

    const grantedFeatures = actor.items.filter(
        i => i.flags?.[MODULE_ID]?.grantedByDualClass === true && !i.flags?.[MODULE_ID]?.isDualClassRuleCarrier
    );

    return {
        primaryName,
        secondaryName,
        secondarySlug,
        secondaryUuid: dualData.uuid ?? null,
        secondaryImg: dualData.itemData.img || "systems/pf2e/icons/default-icons/class.svg",
        hp: { primary: primaryHp, secondary: secondaryHp, effective: effectiveHp },
        saves,
        perception,
        additionalSkills,
        autoTrainedSkills,
        keyAbility: keyInfo,
        grantedFeatureCount: grantedFeatures.length,
        classFeatLevels: extractLevelArray(sSys.classFeatLevels),
        skillFeatLevels: extractLevelArray(sSys.skillFeatLevels)
    };
}

/**
 * Re-prepare and re-render all character actors (and their open sheets).
 */
export function refreshAllCharacterActors() {
    if (!game.actors) return;
    for (const actor of game.actors) {
        if (actor.type === "character") {
            try {
                actor.reset();
            } catch (err) {
                console.warn(`PF2e Awesome Variant Rules | Failed to reset actor ${actor.name}:`, err);
            }
        }
    }
    // Also refresh unlinked token actors on the active scene
    for (const token of canvas?.tokens?.placeables ?? []) {
        if (token.actor?.type === "character" && !token.document?.actorLink) {
            try {
                token.actor.reset();
            } catch { /* ignore */ }
        }
    }
    rerenderOpenCharacterSheets();
}

/**
 * Re-render all currently open CharacterSheetPF2e and AttributeBuilder windows
 * (compatible with both Foundry AppV1 ui.windows and AppV2 foundry.applications.instances).
 */
function rerenderOpenCharacterSheets(targetActorId = null) {
    const apps = new Set();
    if (ui.windows) {
        for (const app of Object.values(ui.windows)) apps.add(app);
    }
    if (foundry?.applications?.instances) {
        for (const app of foundry.applications.instances.values()) apps.add(app);
    }

    for (const app of apps) {
        const appActor = app?.actor ?? app?.document;
        if (!appActor || appActor.type !== "character") continue;
        if (targetActorId && appActor.id !== targetActorId) continue;
        try {
            app.render({ force: false });
        } catch {
            try {
                app.render();
            } catch { /* ignore */ }
        }
    }
}

/* ------------------------------------------------------------------------- */
/* 3. PF2E DATA PREPARATION INTEGRATION                                      */
/* ------------------------------------------------------------------------- */

/**
 * Compute PF2e's attribute modifier & partial-boost state from a raw boost count.
 * PF2e Remaster / Core rules:
 * - Boosts up to +4 give +1 each.
 * - Above +4, every 2 boosts give +1 (odd boost above 4 is a partial boost).
 *
 * @param {number} totalBoosts
 * @returns {{ mod: number, partial: boolean }}
 */
function computeModFromBoostCount(totalBoosts) {
    if (totalBoosts <= 4) {
        return { mod: totalBoosts, partial: false };
    }
    const aboveFour = totalBoosts - 4;
    return {
        mod: 4 + Math.floor(aboveFour / 2),
        partial: (aboveFour % 2) === 1
    };
}

/**
 * Count the character's base build boosts for a specific attribute from `system.build.attributes`,
 * excluding Apex items (handled separately).
 *
 * @param {Actor} actor
 * @param {string} attr
 * @returns {number|null} null if build.attributes is unavailable or in manual mode
 */
function countBaseBuildBoosts(actor, attr) {
    const buildAttrs = actor.system?.build?.attributes;
    if (!buildAttrs || buildAttrs.manual) return null;

    const boosts = buildAttrs.boosts;
    if (!boosts) return null;

    let count = 0;
    const level = Number(actor.level ?? actor.system?.details?.level?.value ?? 1);

    // Ancestry boosts
    if (Array.isArray(boosts.ancestry)) {
        count += boosts.ancestry.filter(a => a === attr).length;
    }

    // Ancestry flaws (and optional voluntary flaws if present)
    const flaws = buildAttrs.flaws;
    if (Array.isArray(flaws?.ancestry)) {
        count -= flaws.ancestry.filter(a => a === attr).length;
    }
    if (Array.isArray(flaws?.voluntary)) {
        count -= flaws.voluntary.filter(a => a === attr).length;
    }

    // Background boosts
    if (Array.isArray(boosts.background)) {
        count += boosts.background.filter(a => a === attr).length;
    }

    // Primary Class boost
    if (typeof boosts.class === "string" && boosts.class === attr) {
        count += 1;
    } else if (Array.isArray(boosts.class)) {
        count += boosts.class.filter(a => a === attr).length;
    }

    // Level-based free boosts (1, 5, 10, 15, 20)
    for (const tier of [1, 5, 10, 15, 20]) {
        if (level >= tier && Array.isArray(boosts[tier])) {
            count += boosts[tier].filter(a => a === attr).length;
        }
    }

    return count;
}

/**
 * Merge Secondary Class baseline stats into the character actor right after
 * `prepareEmbeddedDocuments()` (after Primary Class `prepareActorData()` has run
 * and BEFORE `prepareDerivedData()` calculates HP, Saves, AC, Skills, Strikes, DCs).
 *
 * @param {Actor} actor
 */
function applySecondaryClassBaseData(actor) {
    if (!isDualClassEnabled()) return;
    if (!actor || actor.type !== "character") return;

    const dualData = getSecondaryClassData(actor);
    if (!dualData?.itemData) return;

    const sSys = dualData.itemData.system ?? {};
    const secondSlug = getClassSlug(dualData.itemData);
    const secondName = dualData.itemData.name || "Second Class";

    // Reset per-cycle boost tracking
    actor._pf2eAvrDualClassBoostApplied = false;
    actor._pf2eAvrDualClassBoostState = null;

    // 1. Roll Options so feats, predicates, and rule elements recognize BOTH classes
    if (actor.rollOptions?.all) {
        if (secondSlug) {
            actor.rollOptions.all[`class:${secondSlug}`] = true;
            actor.rollOptions.all[`self:class:${secondSlug}`] = true;
        }
        actor.rollOptions.all["variant:dual-class"] = true;
    }

    // 2. Hit Points per level: take the HIGHER of the two classes (never sum)
    const secondHp = Number(sSys.hp ?? 0);
    if (actor.system?.attributes && secondHp > 0) {
        const currentClassHp = Number(actor.system.attributes.classhp ?? 0);
        actor.system.attributes.classhp = Math.max(currentClassHp, secondHp);
    }

    // 3. Saving Throws: take the HIGHEST initial rank from either class
    //    (Higher-level upgrades come natively from embedded classfeature Rule Elements)
    for (const save of ["fortitude", "reflex", "will"]) {
        const secondRank = Number(sSys.savingThrows?.[save] ?? 0);
        if (secondRank <= 0) continue;

        if (actor.system?.saves?.[save]) {
            const cur = Number(actor.system.saves[save].rank ?? 0);
            if (secondRank > cur) actor.system.saves[save].rank = secondRank;
        }
        if (actor.system?.proficiencies?.saves?.[save]) {
            const cur = Number(actor.system.proficiencies.saves[save].rank ?? 0);
            if (secondRank > cur) actor.system.proficiencies.saves[save].rank = secondRank;
        }
    }

    // 4. Perception: take the HIGHEST initial rank from either class
    const secondPerception = Number(sSys.perception ?? 0);
    if (secondPerception > 0 && actor.system?.perception) {
        const cur = Number(actor.system.perception.rank ?? 0);
        if (secondPerception > cur) actor.system.perception.rank = secondPerception;
    }

    // 5. Weapon / Attack Proficiencies: take the HIGHEST initial rank per category
    if (actor.system?.proficiencies?.attacks && sSys.attacks) {
        for (const cat of ["unarmed", "simple", "martial", "advanced"]) {
            const secondRank = Number(sSys.attacks[cat] ?? 0);
            if (secondRank > 0 && actor.system.proficiencies.attacks[cat]) {
                const cur = Number(actor.system.proficiencies.attacks[cat].rank ?? 0);
                if (secondRank > cur) actor.system.proficiencies.attacks[cat].rank = secondRank;
            }
        }

        // Handle class-specific `attacks.other` (e.g., Wizard/Bard/Rogue specific weapons)
        const otherAttack = sSys.attacks.other;
        if (otherAttack?.name && Number(otherAttack.rank ?? 0) > 0) {
            const otherKey = `dualclass-${secondSlug}-other`;
            if (!actor.system.proficiencies.attacks[otherKey]) {
                actor.system.proficiencies.attacks[otherKey] = {
                    label: otherAttack.name,
                    rank: Number(otherAttack.rank),
                    custom: true
                };
            }
        }
    }

    // 6. Armor / Defense Proficiencies: take the HIGHEST initial rank per category
    if (actor.system?.proficiencies?.defenses && sSys.defenses) {
        for (const cat of ["unarmored", "light", "medium", "heavy"]) {
            const secondRank = Number(sSys.defenses[cat] ?? 0);
            if (secondRank > 0 && actor.system.proficiencies.defenses[cat]) {
                const cur = Number(actor.system.proficiencies.defenses[cat].rank ?? 0);
                if (secondRank > cur) actor.system.proficiencies.defenses[cat].rank = secondRank;
            }
        }
    }

    // 7. Initial Spellcasting Proficiency Rank (if secondary class grants spellcasting)
    const secondSpellcasting = Number(sSys.spellcasting ?? 0);
    if (secondSpellcasting > 0 && actor.system?.proficiencies?.spellcasting) {
        const cur = Number(actor.system.proficiencies.spellcasting.rank ?? 0);
        if (secondSpellcasting > cur) actor.system.proficiencies.spellcasting.rank = secondSpellcasting;
    }

    // 8. Automatic Trained Skills from Secondary Class (official rule: fixed skills from BOTH classes)
    const autoSkills = Array.isArray(sSys.trainedSkills?.value) ? sSys.trainedSkills.value : [];
    for (const rawSkill of autoSkills) {
        const slug = normalizeSkillSlug(rawSkill);
        const skillEntry = actor.system?.skills?.[slug];
        if (skillEntry) {
            const cur = Number(skillEntry.rank ?? 0);
            if (cur < 1) skillEntry.rank = 1;
        }
    }

    // 9. Second Class DC: register in `system.proficiencies.classDCs[secondSlug]`
    //    so PF2e compiles it into a full Statistic and allows classfeatures to upgrade its rank.
    const keyInfo = getSecondaryClassKeyAbility(actor, dualData);
    if (secondSlug && actor.system?.proficiencies?.classDCs) {
        const existingDC = actor.system.proficiencies.classDCs[secondSlug];
        const initialClassDCRank = Number(sSys.classDC ?? 1);
        if (!existingDC) {
            actor.system.proficiencies.classDCs[secondSlug] = {
                slug: secondSlug,
                label: secondName,
                attribute: keyInfo.classDCAttribute || "str",
                rank: initialClassDCRank,
                primary: !actor.class
            };
        } else {
            existingDC.rank = Math.max(Number(existingDC.rank ?? 0), initialClassDCRank);
        }
    }

    // 10. Ensure `actor.feats.assignToSlots` is wrapped once so Dual Class feat slots
    //     are registered before PF2e assigns feats into slots.
    ensureCharacterFeatsWrapped(actor);
}

/**
 * Apply the Secondary Class's 1st-level Key Attribute Boost using exact PF2e partial-boost math.
 * Safe to invoke at multiple pipeline checkpoints (end of `applyActiveEffects` and end of
 * `ActorPF2e.prepareDerivedData`) — detects whether PF2e already computed or recomputed
 * `system.abilities[attr].mod` so the boost is applied EXACTLY ONCE right BEFORE HP, AC,
 * Saves, Perception, Skills, Strikes, Class DCs, and Spellcasting are derived.
 *
 * @param {Actor} actor
 * @param {{ checkpoint?: string }} [options]
 */
function applySecondaryClassKeyAttributeBoost(actor, { checkpoint = "derived" } = {}) {
    if (!isDualClassEnabled()) return;
    if (!actor || actor.type !== "character") return;

    const dualData = getSecondaryClassData(actor);
    if (!dualData?.itemData) return;

    const buildAttrs = actor.system?.build?.attributes;
    // Never fight manual attribute entry mode
    if (buildAttrs?.manual) {
        actor._pf2eAvrDualClassBoostApplied = true;
        return;
    }

    const keyInfo = getSecondaryClassKeyAbility(actor, dualData);
    const boostAttr = keyInfo.effectiveBoostAttribute;
    if (!boostAttr || !actor.system?.abilities?.[boostAttr]) {
        actor._pf2eAvrDualClassBoostApplied = true;
        return;
    }

    const abilityObj = actor.system.abilities[boostAttr];
    const currentMod = Number(abilityObj.mod ?? 0);

    // If already applied earlier in this cycle, verify PF2e didn't subsequently overwrite `.mod`
    // back down when computing `system.build.attributes` at the start of `CharacterPF2e.prepareDerivedData`.
    if (actor._pf2eAvrDualClassBoostApplied && actor._pf2eAvrDualClassBoostState?.attribute === boostAttr) {
        const prevState = actor._pf2eAvrDualClassBoostState;
        if (prevState.delta === 0 || currentMod === prevState.expectedMod) {
            return;
        }
        // PF2e recomputed abilities after our earlier checkpoint — re-apply cleanly below!
    }

    const level = Number(actor.level ?? actor.system?.details?.level?.value ?? 1);
    const baseCount = countBaseBuildBoosts(actor, boostAttr);

    if (baseCount !== null) {
        const baseState = computeModFromBoostCount(baseCount);
        const expectedBaseMod = buildAttrs?.apex === boostAttr
            ? Math.max(baseState.mod + 1, 4)
            : baseState.mod;

        // At early `applyAE` checkpoint, if PF2e hasn't computed abilities yet (e.g. mod is still 0
        // while baseCount expects something else), defer until `ActorPF2e.prepareDerivedData`.
        if (checkpoint === "applyAE" && expectedBaseMod !== 0 && currentMod === 0) {
            return;
        }

        // Official PF2e level-1 cap: cannot exceed +4 before level 5
        const cappedNewCount = level < 5 ? Math.min(baseCount + 1, 4) : (baseCount + 1);
        const newState = computeModFromBoostCount(cappedNewCount);

        let delta = newState.mod - baseState.mod;

        // Account for Apex item on this attribute if worn
        if (buildAttrs?.apex === boostAttr) {
            const apexBase = Math.max(baseState.mod + 1, 4);
            const apexNew = Math.max(newState.mod + 1, 4);
            delta = apexNew - apexBase;
        }

        if (delta !== 0) {
            abilityObj.mod = currentMod + delta;
        }

        actor._pf2eAvrDualClassBoostState = {
            attribute: boostAttr,
            delta,
            baseCount,
            newCount: cappedNewCount,
            partial: newState.partial,
            expectedMod: Number(abilityObj.mod ?? 0),
            applied: true
        };
    } else {
        // Fallback when build.attributes isn't populated
        if (checkpoint === "applyAE") return;
        const delta = (level >= 5 || currentMod < 4) ? 1 : 0;
        if (delta !== 0) {
            abilityObj.mod = currentMod + delta;
        }
        actor._pf2eAvrDualClassBoostState = {
            attribute: boostAttr,
            delta,
            partial: false,
            expectedMod: Number(abilityObj.mod ?? 0),
            applied: true
        };
    }

    actor._pf2eAvrDualClassBoostApplied = true;
}

/**
 * Wrap `CharacterFeats.prototype.assignToSlots` (discovered dynamically from a live `actor.feats`)
 * so that the Dual Class feat group and merged extra skill/general/ancestry feat slots
 * are added BEFORE PF2e assigns embedded feats to their slots.
 *
 * @param {Actor} actor
 */
function ensureCharacterFeatsWrapped(actor) {
    if (featsPrototypeWrapped) return;
    const featsProto = actor?.feats ? Object.getPrototypeOf(actor.feats) : null;
    if (!featsProto || typeof featsProto.assignToSlots !== "function") return;

    const originalAssignToSlots = featsProto.assignToSlots;
    featsProto.assignToSlots = function (...args) {
        try {
            injectDualClassFeatGroups(this);
        } catch (err) {
            console.error("PF2e Awesome Variant Rules | Error preparing Dual Class feat groups:", err);
        }
        return originalAssignToSlots.apply(this, args);
    };

    featsPrototypeWrapped = true;
}

/**
 * Inject the native Dual Class `FeatGroup` into `actor.feats` and merge any unique
 * extra skill/general/ancestry feat levels from the secondary class (e.g., Rogue / Investigator).
 *
 * @param {Collection} featsCollection - `actor.feats` (CharacterFeats instance)
 */
function injectDualClassFeatGroups(featsCollection) {
    if (!isDualClassEnabled()) return;
    const actor = featsCollection?.actor;
    if (!actor || actor.type !== "character") return;

    const dualData = getSecondaryClassData(actor);
    if (!dualData?.itemData) return;

    const sSys = dualData.itemData.system ?? {};
    const secondName = dualData.itemData.name || "Dual Class";
    const secondSlug = getClassSlug(dualData.itemData);
    const primarySlug = getClassSlug(actor.class);
    const actorLevel = Number(actor.level ?? actor.system?.details?.level?.value ?? 1);

    // Discover the live FeatGroup constructor from an existing PF2e FeatGroup
    const classGroup = featsCollection.get("class") ?? featsCollection.values().next().value;
    const FeatGroupClass = classGroup?.constructor;
    if (!FeatGroupClass) return;

    // 1. Build class-specific featFilter matching the running PF2e version's format
    let featFilter = [`category-class`, `traits-${secondSlug}`];
    if (Array.isArray(classGroup?.featFilter) && classGroup.featFilter.length > 0) {
        featFilter = classGroup.featFilter.map(entry => {
            if (primarySlug && entry === `traits-${primarySlug}`) {
                return `traits-${secondSlug}`;
            }
            return entry;
        });
        if (secondSlug && !featFilter.includes(`traits-${secondSlug}`)) {
            featFilter.push(`traits-${secondSlug}`);
        }
    }

    const supported = Array.isArray(classGroup?.supported) ? [...classGroup.supported] : ["class"];

    // 2. Determine secondary class feat slot levels up to actor's current level
    const rawClassFeatLevels = extractLevelArray(sSys.classFeatLevels);
    const defaultClassLevels = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const effectiveLevels = (rawClassFeatLevels.length > 0 ? rawClassFeatLevels : defaultClassLevels)
        .filter(lvl => lvl <= actorLevel);

    const dualClassGroup = new FeatGroupClass(actor, {
        id: "dualclass",
        label: `${secondName} Feats (Dual Class)`,
        featFilter,
        supported,
        slots: effectiveLevels
    });

    // 3. Merge any unique extra Skill / General / Ancestry feat levels (e.g., Rogue / Investigator)
    //    Official rule: shared progressions are NOT doubled, but unique class-specific extra slots ARE kept.
    const mergeExtraGroupLevels = (groupId, classFieldKey) => {
        const existingGroup = featsCollection.get(groupId);
        if (!existingGroup) return;

        const pLevels = extractLevelArray(actor.class?.system?.[classFieldKey]);
        const sLevels = extractLevelArray(sSys[classFieldKey]);
        if (sLevels.length === 0) return;

        // Check if secondary class introduces any level not already in primary class
        const primarySet = new Set(pLevels);
        const hasExtra = sLevels.some(l => l <= actorLevel && !primarySet.has(l));
        if (!hasExtra) return;

        const unionLevels = Array.from(new Set([...pLevels, ...sLevels]))
            .filter(l => l <= actorLevel)
            .sort((a, b) => a - b);

        // Rebuild the group with the unioned levels while preserving its exact PF2e configuration
        const mergedGroup = new FeatGroupClass(actor, {
            id: existingGroup.id,
            label: existingGroup.label,
            featFilter: Array.isArray(existingGroup.featFilter) ? [...existingGroup.featFilter] : undefined,
            supported: Array.isArray(existingGroup.supported) ? [...existingGroup.supported] : undefined,
            slots: unionLevels
        });
        featsCollection.set(groupId, mergedGroup);
    };

    mergeExtraGroupLevels("skill", "skillFeatLevels");
    mergeExtraGroupLevels("general", "generalFeatLevels");
    mergeExtraGroupLevels("ancestry", "ancestryFeatLevels");

    // 4. Insert "dualclass" immediately after "class" in collection order so it renders
    //    right beneath the primary Class Feats section on the Feats tab.
    //    If PF2e Workbench also created a generic "dualclass" group, this cleanly upgrades it.
    const orderedEntries = [];
    let inserted = false;
    for (const [key, value] of featsCollection.entries()) {
        if (key === "dualclass") continue;
        orderedEntries.push([key, value]);
        if (key === "class") {
            orderedEntries.push(["dualclass", dualClassGroup]);
            inserted = true;
        }
    }
    if (!inserted) {
        orderedEntries.push(["dualclass", dualClassGroup]);
    }

    featsCollection.clear();
    for (const [key, value] of orderedEntries) {
        featsCollection.set(key, value);
    }
}

/**
 * Fallback at end of `prepareDerivedData` in case `assignToSlots` wasn't intercepted
 * (e.g., future PF2e refactor). Ensures the `dualclass` group exists and receives slotted feats.
 *
 * @param {Actor} actor
 */
function ensureDualClassFeatGroupFallback(actor) {
    if (!isDualClassEnabled()) return;
    if (!actor || actor.type !== "character") return;
    if (!getSecondaryClassData(actor)) return;
    if (!actor.feats || actor.feats.has("dualclass")) return;

    try {
        injectDualClassFeatGroups(actor.feats);
        const dualGroup = actor.feats.get("dualclass");
        if (dualGroup && typeof dualGroup.assignFeat === "function") {
            for (const feat of actor.itemTypes?.feat ?? []) {
                const loc = feat.system?.location;
                if (typeof loc === "string" && loc.startsWith("dualclass-")) {
                    dualGroup.assignFeat(feat);
                }
            }
        }
    } catch (err) {
        console.warn("PF2e Awesome Variant Rules | Dual Class feat group fallback failed:", err);
    }
}

/**
 * Install prototype wrappers on `CharacterPF2e` (and `ActorPF2e` fallback) once on ready.
 */
function installDualClassWrappers() {
    if (wrappersInstalled) return;

    const CharacterClass = CONFIG.PF2E?.Actor?.documentClasses?.character ?? CONFIG.Actor?.documentClass;
    if (!CharacterClass?.prototype) {
        console.warn("PF2e Awesome Variant Rules | Could not locate CharacterPF2e class for Dual Class.");
        return;
    }

    const proto = CharacterClass.prototype;

    // 1. Wrap `prepareEmbeddedDocuments` -> merges base HP, saves, perception, attacks,
    //    defenses, spellcasting, trained skills, classDC, and rollOptions BEFORE derived data.
    if (typeof proto.prepareEmbeddedDocuments === "function") {
        const originalPrepareEmbedded = proto.prepareEmbeddedDocuments;
        proto.prepareEmbeddedDocuments = function (...args) {
            const result = originalPrepareEmbedded.apply(this, args);
            if (this.type === "character") {
                try {
                    applySecondaryClassBaseData(this);
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Dual Class prepareEmbeddedDocuments error for ${this.name}:`, err);
                }
            }
            return result;
        };
    }

    // 2. Wrap `applyActiveEffects` -> early checkpoint for Secondary Class Key Attribute Boost
    if (typeof proto.applyActiveEffects === "function") {
        const originalApplyAE = proto.applyActiveEffects;
        proto.applyActiveEffects = function (...args) {
            const result = originalApplyAE.apply(this, args);
            if (this.type === "character") {
                try {
                    applySecondaryClassKeyAttributeBoost(this, { checkpoint: "applyAE" });
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Dual Class key attribute boost error for ${this.name}:`, err);
                }
            }
            return result;
        };
    }

    // 3. Wrap `ActorPF2e.prototype.prepareDerivedData` (runs via `super.prepareDerivedData()`
    //    inside `CharacterPF2e.prepareDerivedData`, right AFTER abilities are built and
    //    right BEFORE HP, AC, Saves, Perception, Skills, Strikes, Class DCs, and Spellcasting).
    const BaseActorClass = CONFIG.Actor?.documentClass;
    if (BaseActorClass?.prototype && BaseActorClass.prototype !== proto && typeof BaseActorClass.prototype.prepareDerivedData === "function") {
        const originalBaseDerived = BaseActorClass.prototype.prepareDerivedData;
        BaseActorClass.prototype.prepareDerivedData = function (...args) {
            const result = originalBaseDerived.apply(this, args);
            if (this.type === "character") {
                try {
                    applySecondaryClassKeyAttributeBoost(this, { checkpoint: "baseDerived" });
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Dual Class base prepareDerivedData boost error:`, err);
                }
            }
            return result;
        };
    }

    // 4. Wrap `CharacterPF2e.prototype.prepareDerivedData` -> fallback check for feat group
    //    and key attribute boost verification.
    if (typeof proto.prepareDerivedData === "function") {
        const originalDerived = proto.prepareDerivedData;
        proto.prepareDerivedData = function (...args) {
            const result = originalDerived.apply(this, args);
            if (this.type === "character" && isDualClassEnabled() && getSecondaryClassData(this)) {
                try {
                    applySecondaryClassKeyAttributeBoost(this, { checkpoint: "postDerived" });
                    ensureDualClassFeatGroupFallback(this);
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Dual Class prepareDerivedData error for ${this.name}:`, err);
                }
            }
            return result;
        };
    }

    wrappersInstalled = true;
}

/* ------------------------------------------------------------------------- */
/* 4. CLASS FEATURE AUTO-SYNC ENGINE                                         */
/* ------------------------------------------------------------------------- */

/**
 * Extract the source compendium UUID of an embedded item (supports Foundry v12-v14).
 * @param {Item} item
 * @returns {string|null}
 */
function getItemSourceUuid(item) {
    return item?._stats?.compendiumSource
        ?? item?.flags?.core?.sourceId
        ?? item?.sourceId
        ?? null;
}

/**
 * Check if the actor already possesses a class feature (either from primary class or dual class).
 * @param {Actor} actor
 * @param {string} featureKey
 * @param {string} featureUuid
 * @param {string} featureSlug
 * @returns {boolean}
 */
function actorAlreadyHasFeature(actor, featureKey, featureUuid, featureSlug) {
    for (const item of actor.items) {
        const dcFlags = item.flags?.[MODULE_ID];
        if (dcFlags?.grantedByDualClass && dcFlags.dualClassFeatureKey === featureKey) {
            return true;
        }
        const src = getItemSourceUuid(item);
        if (featureUuid && src && src === featureUuid) {
            return true;
        }
        if (
            featureSlug &&
            NON_STACKING_FEATURE_SLUGS.has(featureSlug) &&
            item.type === "feat" &&
            (item.slug === featureSlug || getClassSlug(item) === featureSlug)
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Collect IDs of all embedded items granted by the dual class, plus any child items
 * granted by those features via `flags.pf2e.grantedBy.id` (recursive cascade).
 *
 * @param {Actor} actor
 * @param {Function} [predicate] Optional filter on the root dual-class features to remove
 * @returns {string[]}
 */
function collectDualClassItemIdsForDeletion(actor, predicate = () => true) {
    const idsToDelete = new Set();

    for (const item of actor.items) {
        if (item.flags?.[MODULE_ID]?.grantedByDualClass === true && predicate(item)) {
            idsToDelete.add(item.id);
        }
    }

    // Recursively find child items granted by PF2e's GrantItem rule elements on those features
    let addedMore = true;
    while (addedMore) {
        addedMore = false;
        for (const item of actor.items) {
            if (idsToDelete.has(item.id)) continue;
            const grantedById = item.flags?.pf2e?.grantedBy?.id;
            if (grantedById && idsToDelete.has(grantedById)) {
                idsToDelete.add(item.id);
                addedMore = true;
            }
        }
    }

    return Array.from(idsToDelete);
}

/**
 * Synchronize second-class features on an actor for their current level:
 * - Optionally refreshes the stored class snapshot from its source UUID.
 * - Grants any missing features with `level <= actor.level` (sorted by level ascending so
 *   1st-level subclass ChoiceSets run before higher-level features).
 * - Deduplicates shared features already granted by the primary class.
 * - Removes dual-class features whose required level is now above `actor.level` (on level down).
 * - Handles classes with direct `system.rules` via a clean carrier feature if needed.
 *
 * @param {Actor} actor
 * @param {{ refreshSource?: boolean, notify?: boolean }} [options]
 * @returns {Promise<{ added: string[], removed: string[] }>}
 */
export async function syncSecondaryClassFeatures(actor, { refreshSource = false, notify = false } = {}) {
    if (!actor || actor.type !== "character") return { added: [], removed: [] };
    if (!isDualClassEnabled()) return { added: [], removed: [] };
    if (syncingActors.has(actor.id)) return { added: [], removed: [] };

    syncingActors.add(actor.id);
    const addedNames = [];
    const removedNames = [];

    try {
        let dualData = getSecondaryClassData(actor);
        if (!dualData?.itemData) return { added: [], removed: [] };

        // Optional refresh from source compendium/world class document
        if (refreshSource && dualData.uuid) {
            try {
                const freshDoc = await fromUuid(dualData.uuid);
                if (freshDoc && freshDoc.type === "class") {
                    const updatedFlag = foundry.utils.deepClone(dualData);
                    updatedFlag.itemData = freshDoc.toObject();
                    delete updatedFlag.itemData._id;
                    await actor.setFlag(MODULE_ID, FLAG_KEY, updatedFlag);
                    dualData = updatedFlag;
                }
            } catch (err) {
                console.warn(`PF2e Awesome Variant Rules | Could not refresh class from UUID ${dualData.uuid}:`, err);
            }
        }

        const actorLevel = Number(actor.level ?? actor.system?.details?.level?.value ?? 1);
        const sData = dualData.itemData;
        const secondSlug = getClassSlug(sData);
        const secondName = sData.name || "Second Class";

        // 1. Remove dual-class features above current level (handles leveling down)
        const overLevelIds = collectDualClassItemIdsForDeletion(actor, (item) => {
            if (item.flags?.[MODULE_ID]?.isDualClassRuleCarrier) return false;
            const grantLevel = Number(item.flags?.[MODULE_ID]?.dualClassFeatureLevel ?? 1);
            return grantLevel > actorLevel;
        });

        if (overLevelIds.length > 0) {
            for (const id of overLevelIds) {
                const it = actor.items.get(id);
                if (it) removedNames.push(it.name);
            }
            await actor.deleteEmbeddedDocuments("Item", overLevelIds);
        }

        // 2. If the class item itself carries direct Rule Elements (`class.system.rules`),
        //    ensure a lightweight carrier feature exists so those rules run natively.
        const classRules = Array.isArray(sData.system?.rules) ? sData.system.rules : [];
        const existingCarrier = actor.items.find(i => i.flags?.[MODULE_ID]?.isDualClassRuleCarrier === true);
        if (classRules.length > 0 && !existingCarrier) {
            await actor.createEmbeddedDocuments("Item", [{
                name: `${secondName} (Dual Class Rules)`,
                type: "feat",
                img: sData.img || "systems/pf2e/icons/default-icons/class.svg",
                system: {
                    category: "classfeature",
                    level: { value: 1 },
                    description: {
                        value: `<p>Applies direct class rule elements from your Dual Class: <strong>${secondName}</strong>.</p>`
                    },
                    rules: foundry.utils.deepClone(classRules),
                    traits: { value: secondSlug ? [secondSlug] : [], rarity: "common" }
                },
                flags: {
                    [MODULE_ID]: {
                        grantedByDualClass: true,
                        isDualClassRuleCarrier: true,
                        dualClassSlug: secondSlug,
                        dualClassUuid: dualData.uuid ?? null,
                        dualClassFeatureLevel: 1
                    }
                }
            }]);
        }

        // 3. Gather all class features from `secondClass.system.items` unlocked at <= actorLevel
        const classItemsMap = sData.system?.items ?? {};
        const entries = Object.entries(classItemsMap)
            .map(([key, entry]) => ({
                key,
                uuid: entry?.uuid,
                name: entry?.name || "",
                level: Number(entry?.level ?? 1)
            }))
            .filter(e => e.uuid && Number.isFinite(e.level) && e.level <= actorLevel)
            .sort((a, b) => a.level - b.level);

        // Process in level order so 1st-level ChoiceSets (subclasses, doctrines, schools, etc.)
        // prompt before higher-level features that might reference them.
        for (const entry of entries) {
            const approxSlug = getClassSlug({ name: entry.name });
            if (actorAlreadyHasFeature(actor, entry.key, entry.uuid, approxSlug)) {
                continue;
            }

            let sourceDoc = null;
            try {
                sourceDoc = await fromUuid(entry.uuid);
            } catch (err) {
                console.warn(`PF2e Awesome Variant Rules | Failed to resolve feature UUID ${entry.uuid}:`, err);
                continue;
            }
            if (!sourceDoc) continue;

            const realSlug = sourceDoc.slug || getClassSlug(sourceDoc);
            if (actorAlreadyHasFeature(actor, entry.key, entry.uuid, realSlug)) {
                continue;
            }

            const itemObj = sourceDoc.toObject();
            delete itemObj._id;

            itemObj.flags = itemObj.flags || {};
            itemObj.flags.core = itemObj.flags.core || {};
            itemObj.flags.core.sourceId = entry.uuid;
            itemObj.flags[MODULE_ID] = {
                grantedByDualClass: true,
                dualClassSlug: secondSlug,
                dualClassUuid: dualData.uuid ?? null,
                dualClassFeatureKey: entry.key,
                dualClassFeatureLevel: entry.level
            };

            itemObj._stats = itemObj._stats || {};
            itemObj._stats.compendiumSource = entry.uuid;

            // Preserve the class-granted level on the feature
            if (itemObj.system?.level) {
                itemObj.system.level.value = entry.level;
            }
            // Ensure class features aren't accidentally stuck in a feat slot location
            if (itemObj.system && itemObj.system.category === "classfeature") {
                itemObj.system.location = null;
            }

            try {
                const created = await actor.createEmbeddedDocuments("Item", [itemObj]);
                if (created?.length > 0) {
                    addedNames.push(created[0].name);
                }
            } catch (err) {
                console.error(`PF2e Awesome Variant Rules | Failed to grant Dual Class feature "${entry.name}":`, err);
            }
        }

        if (notify) {
            if (addedNames.length > 0 || removedNames.length > 0) {
                const parts = [];
                if (addedNames.length > 0) parts.push(`Added ${addedNames.length} feature(s): ${addedNames.join(", ")}`);
                if (removedNames.length > 0) parts.push(`Removed ${removedNames.length} over-level feature(s)`);
                ui.notifications.info(`Dual Class (${secondName}) | ${parts.join(" | ")}`);
            } else {
                ui.notifications.info(`Dual Class (${secondName}) | All class features are already up to date for Level ${actorLevel}.`);
            }
        }

        return { added: addedNames, removed: removedNames };
    } finally {
        syncingActors.delete(actor.id);
    }
}

/**
 * After removing a secondary class, restore any shared features that the Primary Class
 * also grants at `<= actor.level` (in case they had been granted earlier by the removed class).
 *
 * @param {Actor} actor
 */
async function restoreMissingPrimaryClassFeatures(actor) {
    const primary = actor.class;
    if (!primary?.system?.items) return;

    const actorLevel = Number(actor.level ?? actor.system?.details?.level?.value ?? 1);
    const toCreate = [];

    for (const entry of Object.values(primary.system.items)) {
        if (!entry?.uuid) continue;
        const lvl = Number(entry.level ?? 1);
        if (lvl > actorLevel) continue;

        const alreadyExists = actor.items.some(i => getItemSourceUuid(i) === entry.uuid);
        if (alreadyExists) continue;

        try {
            const doc = await fromUuid(entry.uuid);
            if (!doc) continue;
            const obj = doc.toObject();
            delete obj._id;
            obj.flags = obj.flags || {};
            obj.flags.core = obj.flags.core || {};
            obj.flags.core.sourceId = entry.uuid;
            obj.flags.pf2e = obj.flags.pf2e || {};
            obj.flags.pf2e.grantedBy = { id: primary.id, onDelete: "cascade" };
            obj._stats = obj._stats || {};
            obj._stats.compendiumSource = entry.uuid;
            if (obj.system?.level) obj.system.level.value = lvl;
            toCreate.push(obj);
        } catch { /* ignore */ }
    }

    if (toCreate.length > 0) {
        await actor.createEmbeddedDocuments("Item", toCreate);
    }
}

/* ------------------------------------------------------------------------- */
/* 5. SET / REMOVE SECONDARY CLASS OPERATIONS                                */
/* ------------------------------------------------------------------------- */

/**
 * Assign (or replace) the character's Second Class.
 *
 * @param {Actor} actor
 * @param {Item|string} classDocOrUuid - A Class Item document or a Foundry UUID string
 * @returns {Promise<boolean>}
 */
export async function setSecondaryClass(actor, classDocOrUuid) {
    if (!actor || actor.type !== "character") {
        ui.notifications.warn("Dual Class | Only character actors can have a second class.");
        return false;
    }
    if (!isDualClassEnabled()) {
        ui.notifications.warn("Dual Class | Enable the Dual Class Variant Rule in Module Settings first.");
        return false;
    }

    let classDoc = classDocOrUuid;
    if (typeof classDocOrUuid === "string") {
        classDoc = await fromUuid(classDocOrUuid);
    }

    if (!classDoc || classDoc.type !== "class") {
        ui.notifications.warn("Dual Class | Please select or drop a valid PF2e Class item.");
        return false;
    }

    const newSlug = getClassSlug(classDoc);
    const primarySlug = getClassSlug(actor.class);
    if (primarySlug && newSlug && primarySlug === newSlug) {
        ui.notifications.warn(`Dual Class | ${actor.name} already has ${classDoc.name} as their Primary Class. Choose a different class.`);
        return false;
    }

    // If replacing an existing second class, clean up the previous one's granted features first
    const existing = getSecondaryClassData(actor);
    if (existing) {
        const oldIds = collectDualClassItemIdsForDeletion(actor);
        if (oldIds.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", oldIds);
        }
    }

    const itemData = classDoc.toObject();
    delete itemData._id;

    // Pick a smart default key ability (preferring an option that differs from the primary class's key ability)
    const primaryKey = getPrimaryKeyAbility(actor);
    const keyOptions = extractKeyAbilityOptions(itemData.system);
    const defaultKeyAbility = keyOptions.find(opt => opt !== primaryKey) ?? keyOptions[0] ?? null;

    await actor.setFlag(MODULE_ID, FLAG_KEY, {
        uuid: classDoc.uuid ?? null,
        slug: newSlug,
        name: classDoc.name,
        keyAbility: defaultKeyAbility,
        altBoostAbility: null,
        itemData
    });

    // Reset & re-prepare actor so dual class stats take effect immediately
    actor.reset();

    // Auto-grant class features for current level
    if (isAutoGrantFeaturesEnabled()) {
        await syncSecondaryClassFeatures(actor, { refreshSource: false, notify: false });
    }

    actor.reset();
    rerenderOpenCharacterSheets(actor.id);

    ui.notifications.info(`Dual Class | Set ${classDoc.name} as ${actor.name}'s Second Class!`);
    return true;
}

/**
 * Remove the character's Second Class and cleanly delete all its granted class features.
 *
 * @param {Actor} actor
 * @param {{ skipConfirm?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function removeSecondaryClass(actor, { skipConfirm = false } = {}) {
    if (!actor || actor.type !== "character") return false;
    const dualData = getSecondaryClassData(actor);
    if (!dualData) return false;

    const secondName = dualData.itemData?.name || dualData.name || "Second Class";
    const idsToDelete = collectDualClassItemIdsForDeletion(actor);

    if (!skipConfirm) {
        const confirmed = await showConfirmDialog(
            `Remove Second Class (${secondName})`,
            `<p>Remove <strong>${foundry.utils.escapeHTML(secondName)}</strong> as ${foundry.utils.escapeHTML(actor.name)}'s Second Class?</p>
             <p class="notes">This will also remove <strong>${idsToDelete.length}</strong> automatically granted class feature(s). Any manually chosen class feats in Dual Class slots will be preserved in Bonus Feats.</p>`
        );
        if (!confirmed) return false;
    }

    if (idsToDelete.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", idsToDelete);
    }

    await actor.unsetFlag(MODULE_ID, FLAG_KEY);

    // Restore any shared primary class features if they had been covered by the removed second class
    await restoreMissingPrimaryClassFeatures(actor);

    actor.reset();
    rerenderOpenCharacterSheets(actor.id);

    ui.notifications.info(`Dual Class | Removed ${secondName} from ${actor.name}.`);
    return true;
}

/**
 * Update the chosen key attribute (or optional alternative boost attribute) for the actor's Second Class.
 *
 * @param {Actor} actor
 * @param {{ keyAbility?: string, altBoostAbility?: string|null }} updates
 */
export async function updateSecondaryClassKeyAbility(actor, { keyAbility, altBoostAbility } = {}) {
    const dualData = getSecondaryClassData(actor);
    if (!dualData) return;

    const updated = foundry.utils.deepClone(dualData);
    if (keyAbility !== undefined && ABILITY_KEYS.includes(keyAbility)) {
        updated.keyAbility = keyAbility;
    }
    if (altBoostAbility !== undefined) {
        updated.altBoostAbility = (altBoostAbility && ABILITY_KEYS.includes(altBoostAbility)) ? altBoostAbility : null;
    }

    await actor.setFlag(MODULE_ID, FLAG_KEY, updated);
    actor.reset();
    rerenderOpenCharacterSheets(actor.id);
}

/* ------------------------------------------------------------------------- */
/* 6. DIALOGS (FOUNDRY V14 DialogV2 + FALLBACK)                              */
/* ------------------------------------------------------------------------- */

/**
 * Show a simple confirmation dialog using DialogV2 (Foundry v14+) with Dialog fallback.
 */
async function showConfirmDialog(title, content) {
    if (foundry?.applications?.api?.DialogV2?.confirm) {
        return Boolean(await foundry.applications.api.DialogV2.confirm({
            window: { title },
            content,
            rejectClose: false
        }));
    }
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
        return Boolean(await Dialog.confirm({ title, content }));
    }
    return window.confirm(title);
}

/**
 * Gather all available PF2e Class items from compendiums and the World Items directory,
 * deduplicated and excluding the actor's current primary class and Workbench merged dual classes.
 *
 * @param {Actor} actor
 * @returns {Promise<Array<object>>}
 */
async function gatherAvailableClasses(actor) {
    const primarySlug = getClassSlug(actor.class);
    const results = [];
    const seenKeys = new Set();

    // Helper to check if a class item looks like a Workbench/macro pre-merged dual class
    const isMergedDualClass = (name, slug, flags) => {
        if (flags?.["pf2e-dual-class"] || flags?.["xdy-pf2e-workbench"]?.dualClass) return true;
        if (String(name || "").includes(" - ") && String(slug || "").includes("-")) {
            // Workbench dual-class macro names items "Fighter - Wizard"
            return true;
        }
        return false;
    };

    // 1. World Class Items (homebrew / custom classes first so they're easy to find)
    for (const item of game.items ?? []) {
        if (item.type !== "class") continue;
        const slug = getClassSlug(item);
        if (primarySlug && slug === primarySlug) continue;
        if (isMergedDualClass(item.name, slug, item.flags)) continue;

        const key = `world:${item.id}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        results.push({
            uuid: item.uuid,
            name: item.name,
            slug,
            img: item.img || "systems/pf2e/icons/default-icons/class.svg",
            source: "World",
            hp: Number(item.system?.hp ?? 0),
            keyOptions: extractKeyAbilityOptions(item.system),
            saves: {
                fort: Number(item.system?.savingThrows?.fortitude ?? 0),
                ref: Number(item.system?.savingThrows?.reflex ?? 0),
                will: Number(item.system?.savingThrows?.will ?? 0)
            },
            perception: Number(item.system?.perception ?? 0)
        });
    }

    // 2. Compendium Packs containing `class` items (pf2e.classes first, then any module packs)
    const itemPacks = Array.from(game.packs ?? [])
        .filter(p => p.documentName === "Item")
        .sort((a, b) => {
            if (a.collection === "pf2e.classes") return -1;
            if (b.collection === "pf2e.classes") return 1;
            return a.title.localeCompare(b.title);
        });

    for (const pack of itemPacks) {
        let index;
        try {
            index = await pack.getIndex({
                fields: ["type", "img", "system.hp", "system.keyAbility", "system.savingThrows", "system.perception", "system.slug"]
            });
        } catch {
            continue;
        }

        for (const entry of index) {
            if (entry.type !== "class") continue;
            const slug = getClassSlug(entry);
            if (primarySlug && slug === primarySlug) continue;
            if (isMergedDualClass(entry.name, slug, entry.flags)) continue;

            // Avoid duplicate slugs from compendium copies if already in results from pf2e.classes
            const dedupeKey = `comp:${slug}:${pack.collection}`;
            if (seenKeys.has(dedupeKey)) continue;
            seenKeys.add(dedupeKey);

            results.push({
                uuid: entry.uuid || `Compendium.${pack.collection}.Item.${entry._id}`,
                name: entry.name,
                slug,
                img: entry.img || "systems/pf2e/icons/default-icons/class.svg",
                source: pack.collection === "pf2e.classes" ? "PF2e Core" : pack.title,
                hp: Number(entry.system?.hp ?? 0),
                keyOptions: extractKeyAbilityOptions(entry.system),
                saves: {
                    fort: Number(entry.system?.savingThrows?.fortitude ?? 0),
                    ref: Number(entry.system?.savingThrows?.reflex ?? 0),
                    will: Number(entry.system?.savingThrows?.will ?? 0)
                },
                perception: Number(entry.system?.perception ?? 0)
            });
        }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
}

/**
 * Open a sleek searchable Class Picker dialog to select the actor's Second Class.
 *
 * @param {Actor} actor
 */
export async function openSecondaryClassPicker(actor) {
    if (!actor || actor.type !== "character") return;
    if (!isDualClassEnabled()) {
        ui.notifications.warn("Dual Class | Enable the Dual Class Variant Rule in Module Settings first.");
        return;
    }

    const classes = await gatherAvailableClasses(actor);
    if (classes.length === 0) {
        ui.notifications.warn("Dual Class | No PF2e classes were found in compendiums or World Items.");
        return;
    }

    const currentDual = getSecondaryClassData(actor);
    const currentUuid = currentDual?.uuid ?? null;
    const primaryName = actor.class?.name || "None";
    const esc = foundry.utils.escapeHTML;

    const listItemsHtml = classes.map(cls => {
        const isSelected = currentUuid && cls.uuid === currentUuid;
        const keyStr = cls.keyOptions.length > 0
            ? cls.keyOptions.map(k => ABILITY_LABELS[k] || k.toUpperCase()).join(" / ")
            : "—";
        const savesStr = `F:${RANK_LABELS[cls.saves.fort] || "U"} R:${RANK_LABELS[cls.saves.ref] || "U"} W:${RANK_LABELS[cls.saves.will] || "U"}`;
        const percStr = `P:${RANK_LABELS[cls.perception] || "U"}`;

        return `
            <button type="button"
                class="pf2e-avr-dc-picker-item ${isSelected ? "is-current is-selected" : ""}"
                data-uuid="${esc(cls.uuid)}"
                data-name="${esc(cls.name)}"
                data-search="${esc(`${cls.name} ${cls.source} ${keyStr}`.toLowerCase())}">
                <img class="dc-class-icon" src="${esc(cls.img)}" alt="" />
                <div class="dc-class-info">
                    <div class="dc-class-name-row">
                        <span class="dc-class-name">${esc(cls.name)}</span>
                        <span class="dc-class-source">${esc(cls.source)}</span>
                    </div>
                    <div class="dc-class-stats">
                        <span class="dc-stat-pill" title="Hit Points per level">${cls.hp} HP</span>
                        <span class="dc-stat-pill" title="Key Attribute">${esc(keyStr)}</span>
                        <span class="dc-stat-pill" title="Initial Saves (Fortitude / Reflex / Will)">${savesStr}</span>
                        <span class="dc-stat-pill" title="Initial Perception">${percStr}</span>
                    </div>
                </div>
                <span class="dc-selected-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
            </button>
        `;
    }).join("");

    const content = `
        <div class="pf2e-avr-dc-picker">
            <div class="dc-picker-header">
                <div class="dc-picker-subtitle">
                    Primary Class: <strong>${esc(primaryName)}</strong> &bull; Choose a Second Class for <strong>${esc(actor.name)}</strong>
                </div>
                <div class="dc-picker-search-wrap">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="search" class="dc-picker-search" placeholder="Filter classes by name or key attribute..." autocomplete="off" />
                </div>
            </div>
            <div class="dc-picker-list">
                ${listItemsHtml}
            </div>
            <div class="dc-picker-hint">Click a class to highlight it, then click <strong>Select Class</strong> (or double-click a class to choose immediately).</div>
        </div>
    `;

    let selectedUuid = currentUuid;
    let selectedName = currentDual?.itemData?.name || currentDual?.name || "";

    const bindPickerListeners = (rootEl, confirmFn) => {
        if (!rootEl || rootEl.dataset.dcPickerBound === "1") return;
        rootEl.dataset.dcPickerBound = "1";

        const searchInput = rootEl.querySelector(".dc-picker-search");
        const items = Array.from(rootEl.querySelectorAll(".pf2e-avr-dc-picker-item"));
        const selectBtn = rootEl.querySelector('button[data-action="select"], button.dc-confirm-btn');

        const updateConfirmButton = () => {
            if (!selectBtn) return;
            selectBtn.disabled = !selectedUuid;
            const labelSpan = selectBtn.querySelector("span");
            const nextLabel = selectedName ? `Select ${selectedName}` : "Select Class";
            if (labelSpan) {
                labelSpan.textContent = nextLabel;
            } else {
                selectBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(nextLabel)}`;
            }
        };

        updateConfirmButton();

        searchInput?.addEventListener("input", () => {
            const q = searchInput.value.trim().toLowerCase();
            for (const btn of items) {
                const hay = btn.dataset.search || "";
                btn.style.display = (!q || hay.includes(q)) ? "" : "none";
            }
        });

        for (const btn of items) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                for (const other of items) other.classList.remove("is-selected");
                btn.classList.add("is-selected");
                selectedUuid = btn.dataset.uuid || null;
                selectedName = btn.dataset.name || "";
                updateConfirmButton();
            });

            btn.addEventListener("dblclick", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                selectedUuid = btn.dataset.uuid || null;
                selectedName = btn.dataset.name || "";
                if (selectedUuid) {
                    await confirmFn(selectedUuid);
                }
            });
        }

        setTimeout(() => searchInput?.focus(), 40);
    };

    if (foundry?.applications?.api?.DialogV2) {
        const dialog = new foundry.applications.api.DialogV2({
            window: {
                title: `Select Second Class — ${actor.name}`,
                icon: "fa-solid fa-shield-halved"
            },
            position: { width: 500 },
            content,
            buttons: [
                {
                    action: "select",
                    label: selectedName ? `Select ${selectedName}` : "Select Class",
                    icon: "fa-solid fa-check",
                    default: true,
                    callback: async () => {
                        if (!selectedUuid) {
                            ui.notifications.warn("Dual Class | Please select a class from the list first.");
                            return false;
                        }
                        await setSecondaryClass(actor, selectedUuid);
                    }
                },
                {
                    action: "cancel",
                    label: "Cancel",
                    icon: "fa-solid fa-times"
                }
            ]
        });

        dialog.addEventListener("render", () => {
            bindPickerListeners(dialog.element, async (uuid) => {
                await dialog.close();
                await setSecondaryClass(actor, uuid);
            });
        });

        await dialog.render({ force: true });
        // Also bind immediately in case render resolved synchronously
        bindPickerListeners(dialog.element, async (uuid) => {
            await dialog.close();
            await setSecondaryClass(actor, uuid);
        });
    } else if (typeof Dialog !== "undefined") {
        let legacyDialog;
        legacyDialog = new Dialog({
            title: `Select Second Class — ${actor.name}`,
            content,
            buttons: {
                select: {
                    icon: '<i class="fas fa-check"></i>',
                    label: selectedName ? `Select ${selectedName}` : "Select Class",
                    callback: async () => {
                        if (!selectedUuid) {
                            ui.notifications.warn("Dual Class | Please select a class from the list first.");
                            return;
                        }
                        await setSecondaryClass(actor, selectedUuid);
                    }
                },
                cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
            },
            default: "select",
            render: (html) => {
                const el = html instanceof HTMLElement ? html : html[0];
                bindPickerListeners(el, async (uuid) => {
                    legacyDialog.close();
                    await setSecondaryClass(actor, uuid);
                });
            }
        }, { width: 500 });
        legacyDialog.render(true);
    }
}

/* ------------------------------------------------------------------------- */
/* 7. CHARACTER SHEET & ATTRIBUTE BUILDER UI INTEGRATION                     */
/* ------------------------------------------------------------------------- */

/**
 * Locate the Primary Class detail container inside `CharacterSheetPF2e` DOM.
 * Resilient across PF2e template variations.
 *
 * @param {HTMLElement} root
 * @returns {HTMLElement|null}
 */
function findPrimaryClassContainer(root) {
    // Modern PF2e character sheet (`.detail.class` or `.pc.pc_class`)
    const direct = root.querySelector(".detail.class, .pc.pc_class, [data-detail-type='class']");
    if (direct) return direct;

    // Fallback: locate the button that opens the `pf2e.classes` compendium
    const classCompendiumBtn = root.querySelector(
        '[data-compendium="pf2e.classes"], [data-action="open-compendium"][data-compendium*="class"], a[data-pack="pf2e.classes"]'
    );
    if (classCompendiumBtn) {
        const container = classCompendiumBtn.closest(".detail, .pc, .detail-item, .character-detail");
        if (container) return container;
    }

    // Fallback: find a `.detail` element whose label reads "Class"
    const detailNodes = root.querySelectorAll(".character-details .detail, .details .detail, .pc");
    for (const node of detailNodes) {
        const labelText = (node.querySelector("h3, h4, label, .detail-label, span.label")?.textContent || "").trim().toLowerCase();
        if (labelText === "class") return node;
    }

    return null;
}

/**
 * Build a multi-line tooltip summarizing combined Dual Class stats.
 * @param {object} summary
 * @returns {string}
 */
function buildSummaryTooltip(summary) {
    const lines = [
        `Dual Class: ${summary.primaryName} / ${summary.secondaryName}`,
        `HP/Level: ${summary.hp.effective} (higher of ${summary.hp.primary} vs ${summary.hp.secondary})`,
        `Base Saves: Fort ${RANK_FULL_LABELS[summary.saves.fortitude.effective]}, Ref ${RANK_FULL_LABELS[summary.saves.reflex.effective]}, Will ${RANK_FULL_LABELS[summary.saves.will.effective]}`,
        `Base Perception: ${RANK_FULL_LABELS[summary.perception.effective]}`,
        `Additional Skills: ${summary.additionalSkills.effective} + INT (${summary.additionalSkills.source})`,
        `Granted Features: ${summary.grantedFeatureCount}`
    ];
    if (summary.autoTrainedSkills.length > 0) {
        lines.push(`Auto-Trained Skills (${summary.secondaryName}): ${summary.autoTrainedSkills.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}`);
    }
    if (summary.keyAbility.isSharedWithPrimary && !summary.keyAbility.effectiveBoostAttribute) {
        lines.push(`Key Attribute: ${ABILITY_LABELS[summary.keyAbility.selected] || "—"} (shared with Primary — no double class boost per PF2e rules)`);
    } else if (summary.keyAbility.effectiveBoostAttribute) {
        lines.push(`Dual Class Key Boost: +1 ${ABILITY_LABELS[summary.keyAbility.effectiveBoostAttribute]}`);
    }
    return lines.join("\n");
}

/**
 * Open a view sheet for the actor's secondary class item (from source UUID or ephemeral snapshot).
 * @param {object} dualData
 */
async function openSecondaryClassSheet(dualData) {
    if (!dualData?.itemData) return;

    if (dualData.uuid) {
        try {
            const doc = await fromUuid(dualData.uuid);
            if (doc?.sheet) {
                doc.sheet.render(true);
                return;
            }
        } catch { /* fall through to snapshot */ }
    }

    try {
        const ItemCls = CONFIG.Item.documentClass;
        const tempItem = new ItemCls(foundry.utils.deepClone(dualData.itemData));
        tempItem.sheet?.render(true);
    } catch (err) {
        console.warn("PF2e Awesome Variant Rules | Could not render secondary class sheet:", err);
    }
}

/**
 * Handle dropping an item onto the Second Class drop zone on the character sheet.
 * @param {DragEvent} ev
 * @param {Actor} actor
 */
async function handleDropOnSecondClass(ev, actor) {
    ev.preventDefault();
    ev.stopPropagation();

    let dropData = null;
    try {
        const TextEditorImpl = foundry?.applications?.ux?.TextEditor?.implementation ?? TextEditor;
        dropData = TextEditorImpl.getDragEventData(ev);
    } catch {
        try {
            dropData = JSON.parse(ev.dataTransfer?.getData("text/plain") || "{}");
        } catch {
            dropData = null;
        }
    }

    if (!dropData) return;

    let itemDoc = null;
    if (dropData.uuid) {
        itemDoc = await fromUuid(dropData.uuid);
    } else if (dropData.type === "Item" && dropData.data) {
        const ItemCls = CONFIG.Item.documentClass;
        itemDoc = new ItemCls(dropData.data);
    }

    if (!itemDoc || itemDoc.type !== "class") {
        ui.notifications.warn("Dual Class | Only PF2e Class items can be dropped into the Second Class slot.");
        return;
    }

    await setSecondaryClass(actor, itemDoc);
}

/**
 * Inject the Second Class field onto `CharacterSheetPF2e`, plus optional Skills tab indicator.
 */
function registerCharacterSheetIntegration() {
    Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
        if (!isDualClassEnabled()) return;

        const actor = sheet?.actor ?? sheet?.document;
        if (!actor || actor.type !== "character") return;

        const root = html instanceof HTMLElement ? html : (html?.[0] ?? sheet?.element);
        if (!root || !root.querySelector) return;

        const isEditable = sheet.isEditable ?? actor.isOwner;
        const dualData = getSecondaryClassData(actor);
        const summary = dualData ? getDualClassSummary(actor) : null;
        const esc = foundry.utils.escapeHTML;

        // --- A. Inject Second Class Field in Character Details ---
        if (!root.querySelector(".pf2e-avr-dual-class-detail")) {
            const primaryClassEl = findPrimaryClassContainer(root);
            if (primaryClassEl) {
                const container = document.createElement("div");
                container.className = `detail pf2e-avr-dual-class-detail ${dualData ? "has-second-class" : "is-empty"}`;

                if (dualData && summary) {
                    const keyInfo = summary.keyAbility;
                    const tooltip = buildSummaryTooltip(summary);
                    const manualMode = Boolean(actor.system?.build?.attributes?.manual);

                    // Build Key Attribute selector or badge
                    let keyControlHtml = "";
                    if (isEditable && keyInfo.options.length > 1) {
                        const opts = keyInfo.options.map(k => {
                            const sharedTag = k === keyInfo.primaryKey ? " (shared)" : "";
                            return `<option value="${k}" ${keyInfo.selected === k ? "selected" : ""}>${ABILITY_LABELS[k]}${sharedTag}</option>`;
                        }).join("");
                        keyControlHtml = `
                            <select class="dc-key-select" title="Second Class Key Attribute${manualMode ? ' (Manual attribute mode active)' : ''}">
                                ${opts}
                            </select>
                        `;
                    } else if (isEditable && keyInfo.isSharedWithPrimary && keyInfo.allowAlternative) {
                        const altOpts = [
                            `<option value="" ${!keyInfo.effectiveBoostAttribute ? "selected" : ""}>${ABILITY_LABELS[keyInfo.selected] || "—"} (Shared)</option>`,
                            ...ABILITY_KEYS.filter(k => k !== keyInfo.primaryKey).map(k =>
                                `<option value="${k}" ${keyInfo.effectiveBoostAttribute === k ? "selected" : ""}>+1 ${ABILITY_LABELS[k]} (Alt)</option>`
                            )
                        ].join("");
                        keyControlHtml = `
                            <select class="dc-alt-key-select" title="Both classes share ${ABILITY_LABELS[keyInfo.selected]}. Choose an alternative attribute boost (House Rule enabled).">
                                ${altOpts}
                            </select>
                        `;
                    } else if (keyInfo.selected) {
                        const isShared = keyInfo.isSharedWithPrimary && !keyInfo.effectiveBoostAttribute;
                        const pillClass = isShared ? "dc-key-pill is-shared" : "dc-key-pill";
                        const pillText = isShared
                            ? `${ABILITY_LABELS[keyInfo.selected]} (Shared)`
                            : (manualMode ? `${ABILITY_LABELS[keyInfo.selected]}` : `+1 ${ABILITY_LABELS[keyInfo.selected]}`);
                        const pillTitle = isShared
                            ? "Both classes share this key attribute. Per official PF2e Dual Class rules, class key boosts do not stack on the same attribute."
                            : (manualMode ? "Manual attribute entry mode is enabled on this character." : `Dual Class Key Attribute Boost (+1 ${ABILITY_LABELS[keyInfo.selected]})`);
                        keyControlHtml = `<span class="${pillClass}" title="${esc(pillTitle)}">${esc(pillText)}</span>`;
                    }

                    container.innerHTML = `
                        <span class="detail-label pf2e-avr-dc-label" title="${esc(tooltip)}">
                            <span>Second Class</span>
                            ${keyControlHtml}
                        </span>
                        <div class="pf2e-avr-dc-value-row" title="${esc(tooltip)}">
                            <a class="pf2e-avr-dc-name" data-action="view-second-class">
                                <span>${esc(summary.secondaryName)}</span>
                            </a>
                            ${isEditable ? `
                                <div class="pf2e-avr-dc-controls">
                                    <button type="button" class="pf2e-avr-dc-btn" data-action="pick-second-class" title="Change Second Class">
                                        <i class="fa-solid fa-magnifying-glass fa-fw"></i>
                                    </button>
                                    <button type="button" class="pf2e-avr-dc-btn" data-action="sync-second-class" title="Resync Second Class Features (${summary.grantedFeatureCount} granted)">
                                        <i class="fa-solid fa-arrows-rotate fa-fw"></i>
                                    </button>
                                    <button type="button" class="pf2e-avr-dc-btn dc-btn-danger" data-action="remove-second-class" title="Remove Second Class">
                                        <i class="fa-solid fa-trash fa-fw"></i>
                                    </button>
                                </div>
                            ` : ""}
                        </div>
                    `;
                } else {
                    container.innerHTML = `
                        <span class="detail-label pf2e-avr-dc-label">
                            <span>Second Class</span>
                        </span>
                        <div class="pf2e-avr-dc-value-row is-empty-row">
                            <span class="pf2e-avr-dc-placeholder ${isEditable ? "is-clickable" : ""}" data-action="pick-second-class">
                                ${isEditable ? "" : "None"}
                            </span>
                            ${isEditable ? `
                                <div class="pf2e-avr-dc-controls">
                                    <button type="button" class="pf2e-avr-dc-btn dc-btn-search" data-action="pick-second-class" title="Choose or Drop Second Class">
                                        <i class="fa-solid fa-magnifying-glass fa-fw"></i>
                                    </button>
                                </div>
                            ` : ""}
                        </div>
                    `;
                }

                // Event listeners
                container.querySelector('[data-action="view-second-class"]')?.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openSecondaryClassSheet(dualData);
                });

                if (isEditable) {
                    container.querySelectorAll('[data-action="pick-second-class"]').forEach(el => {
                        el.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            openSecondaryClassPicker(actor);
                        });
                    });

                    container.querySelector('[data-action="sync-second-class"]')?.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        await syncSecondaryClassFeatures(actor, { refreshSource: true, notify: true });
                        actor.reset();
                        rerenderOpenCharacterSheets(actor.id);
                    });

                    container.querySelector('[data-action="remove-second-class"]')?.addEventListener("click", async (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        await removeSecondaryClass(actor);
                    });

                    container.querySelector(".dc-key-select")?.addEventListener("change", async (ev) => {
                        ev.stopPropagation();
                        await updateSecondaryClassKeyAbility(actor, { keyAbility: ev.target.value });
                    });

                    container.querySelector(".dc-alt-key-select")?.addEventListener("change", async (ev) => {
                        ev.stopPropagation();
                        await updateSecondaryClassKeyAbility(actor, { altBoostAbility: ev.target.value || null });
                    });

                    // Native Drag & Drop directly onto the Second Class slot
                    container.addEventListener("dragover", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        container.classList.add("is-dragover");
                    });
                    container.addEventListener("dragleave", () => {
                        container.classList.remove("is-dragover");
                    });
                    container.addEventListener("drop", async (ev) => {
                        container.classList.remove("is-dragover");
                        await handleDropOnSecondClass(ev, actor);
                    });
                }

                primaryClassEl.insertAdjacentElement("afterend", container);
            }
        }

        // --- B. Skills Tab: Show Higher Additional Trained Skills Info Pill ---
        if (summary && !root.querySelector(".pf2e-avr-dc-skills-note")) {
            const profTab = root.querySelector('.tab[data-tab="proficiencies"], .tab[data-tab="skills"]');
            if (profTab && summary.additionalSkills.secondary > summary.additionalSkills.primary) {
                const intMod = Number(actor.system?.abilities?.int?.mod ?? 0);
                const totalAdditional = Math.max(0, summary.additionalSkills.effective + intMod);
                const note = document.createElement("div");
                note.className = "pf2e-avr-dc-skills-note";
                note.innerHTML = `
                    <i class="fa-solid fa-graduation-cap"></i>
                    <span>
                        <strong>Dual Class Skills:</strong>
                        Using higher additional skill count from <strong>${esc(summary.secondaryName)}</strong>:
                        <strong>${summary.additionalSkills.effective} + INT (${totalAdditional} total)</strong>
                        plus auto-trained skills from both classes.
                    </span>
                `;
                profTab.prepend(note);
            }
        }
    });
}

/**
 * Integrate a Dual Class Key Attribute Boost banner into PF2e's native Attribute Builder window
 * so players see and configure their second class key boost alongside Ancestry/Background/Class boosts.
 */
function registerAttributeBuilderIntegration() {
    Hooks.on("renderAttributeBuilder", (app, html) => {
        if (!isDualClassEnabled()) return;

        const actor = app?.actor ?? app?.document;
        if (!actor || actor.type !== "character") return;

        const dualData = getSecondaryClassData(actor);
        if (!dualData) return;

        const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
        if (!root || !root.querySelector) return;
        if (root.querySelector(".pf2e-avr-dc-attr-banner")) return;

        const summary = getDualClassSummary(actor);
        if (!summary) return;

        const keyInfo = summary.keyAbility;
        const boostState = actor._pf2eAvrDualClassBoostState;
        const manualMode = Boolean(actor.system?.build?.attributes?.manual);
        const isEditable = app.isEditable ?? actor.isOwner;
        const esc = foundry.utils.escapeHTML;

        let statusHtml = "";
        if (manualMode) {
            statusHtml = `<span class="dc-attr-status is-muted">Manual Entry Mode active — manage ability modifiers manually.</span>`;
        } else if (keyInfo.effectiveBoostAttribute) {
            const attrLabel = ABILITY_LABELS[keyInfo.effectiveBoostAttribute];
            const partialNote = boostState?.partial ? " (partial boost above +4)" : "";
            statusHtml = `<span class="dc-attr-status is-active">+1 Boost applied to <strong>${attrLabel}</strong>${partialNote}</span>`;
        } else if (keyInfo.isSharedWithPrimary) {
            statusHtml = `<span class="dc-attr-status is-shared">Shared Key Attribute (<strong>${ABILITY_LABELS[keyInfo.selected]}</strong>) — per PF2e Dual Class rules, class boosts cannot stack on the same attribute.</span>`;
        } else {
            statusHtml = `<span class="dc-attr-status is-muted">No key attribute selected.</span>`;
        }

        let controlHtml = "";
        if (isEditable && !manualMode) {
            if (keyInfo.options.length > 1) {
                const opts = keyInfo.options.map(k => {
                    const shared = k === keyInfo.primaryKey ? " (shared)" : "";
                    return `<option value="${k}" ${keyInfo.selected === k ? "selected" : ""}>${ABILITY_LABELS[k]}${shared}</option>`;
                }).join("");
                controlHtml = `
                    <label class="dc-attr-select-wrap">
                        <span>Key Attr:</span>
                        <select class="dc-attr-builder-select">${opts}</select>
                    </label>
                `;
            } else if (keyInfo.isSharedWithPrimary && keyInfo.allowAlternative) {
                const altOpts = [
                    `<option value="" ${!keyInfo.effectiveBoostAttribute ? "selected" : ""}>None (RAW)</option>`,
                    ...ABILITY_KEYS.filter(k => k !== keyInfo.primaryKey).map(k =>
                        `<option value="${k}" ${keyInfo.effectiveBoostAttribute === k ? "selected" : ""}>${ABILITY_LABELS[k]}</option>`
                    )
                ].join("");
                controlHtml = `
                    <label class="dc-attr-select-wrap">
                        <span>Alt Boost:</span>
                        <select class="dc-attr-builder-alt-select">${altOpts}</select>
                    </label>
                `;
            }
        }

        const banner = document.createElement("div");
        banner.className = "pf2e-avr-dc-attr-banner";
        banner.innerHTML = `
            <div class="dc-attr-banner-left">
                <i class="fa-solid fa-shield-halved"></i>
                <div>
                    <div class="dc-attr-title">Dual Class Boost: <strong>${esc(summary.secondaryName)}</strong></div>
                    ${statusHtml}
                </div>
            </div>
            <div class="dc-attr-banner-right">
                ${controlHtml}
            </div>
        `;

        banner.querySelector(".dc-attr-builder-select")?.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await updateSecondaryClassKeyAbility(actor, { keyAbility: ev.target.value });
        });

        banner.querySelector(".dc-attr-builder-alt-select")?.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await updateSecondaryClassKeyAbility(actor, { altBoostAbility: ev.target.value || null });
        });

        // Insert near the top of the Attribute Builder form/content
        const target = root.querySelector(".window-content form, form, .window-content") || root;
        target.prepend(banner);
    });
}

/* ------------------------------------------------------------------------- */
/* 8. LEVEL-UP / ACTOR UPDATE HOOK                                           */
/* ------------------------------------------------------------------------- */

function registerLevelUpHook() {
    Hooks.on("updateActor", async (actor, changes, _options, userId) => {
        if (game.user.id !== userId) return;
        if (!isDualClassEnabled() || !isAutoGrantFeaturesEnabled()) return;
        if (!actor || actor.type !== "character") return;
        if (!getSecondaryClassData(actor)) return;

        // Trigger auto-sync whenever character level changes
        const levelChanged = foundry.utils.hasProperty(changes, "system.details.level.value");
        if (!levelChanged) return;

        await syncSecondaryClassFeatures(actor, { refreshSource: false, notify: true });
        actor.reset();
        rerenderOpenCharacterSheets(actor.id);
    });
}

/* ------------------------------------------------------------------------- */
/* 9. INITIALIZATION                                                         */
/* ------------------------------------------------------------------------- */

export function initDualClass() {
    installDualClassWrappers();
    registerCharacterSheetIntegration();
    registerAttributeBuilderIntegration();
    registerLevelUpHook();

    // If Dual Class is enabled at startup, re-prepare characters that already have a second class
    if (isDualClassEnabled() && game.actors) {
        for (const actor of game.actors) {
            if (actor.type === "character" && getSecondaryClassData(actor)) {
                try {
                    actor.reset();
                } catch (err) {
                    console.warn(`PF2e Awesome Variant Rules | Initial Dual Class reset failed for ${actor.name}:`, err);
                }
            }
        }
    }

    console.log("PF2e Awesome Variant Rules | Dual Class Variant Rule Initialized.");
}
