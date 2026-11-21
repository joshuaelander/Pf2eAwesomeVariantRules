/**
 * PF2e Awesome Variant Rules: Ancestry Paragon Variant Rule
 *
 * Implements the Pathfinder 2e Ancestry Paragon variant rule (Gamemastery Guide / GM Core):
 * - Characters gain 2 Ancestry Feats at 1st level and an Ancestry Feat at every odd level
 *   thereafter (1, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19 — 11 total Ancestry Feats).
 * - Adds a dedicated native "Ancestry Paragon Feats" FeatGroup right below "Ancestry Feats"
 *   on the character sheet's Feats tab, pre-configured with the character's exact ancestry
 *   and versatile heritage Compendium Browser filters and level caps.
 * - Off by default in module settings; non-destructive if toggled off later.
 */

const MODULE_ID = "pf2e-awesome-variant-rules";
const PARAGON_GROUP_ID = "ancestryparagon";

/** All odd character levels where Ancestry Paragon grants ancestry feats (plus an extra 1st-level feat) */
const ALL_ODD_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];

let wrappersInstalled = false;
let featsPrototypeWrapped = false;

/* ------------------------------------------------------------------------- */
/* 1. SETTINGS REGISTRATION                                                  */
/* ------------------------------------------------------------------------- */

export function registerAncestryParagonSettings() {
    game.settings.register(MODULE_ID, "ancestryParagonEnabled", {
        name: "Enable Ancestry Paragon Variant Rule",
        hint: "Grants characters an extra 1st-level Ancestry Feat and an additional Ancestry Feat at every odd level they wouldn't normally gain one (levels 1, 3, 7, 11, 15, and 19 — 11 Ancestry Feats total).",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            refreshCharacterActorsForParagon();
        }
    });
}

export function isAncestryParagonEnabled() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "ancestryParagonEnabled"));
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------------- */
/* 2. HELPERS                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Re-prepare character actors and re-render open character sheets when the setting toggles.
 */
function refreshCharacterActorsForParagon() {
    if (!game.actors) return;
    for (const actor of game.actors) {
        if (actor.type === "character") {
            try {
                actor.reset();
            } catch (err) {
                console.warn(`PF2e Awesome Variant Rules | Ancestry Paragon reset failed for ${actor.name}:`, err);
            }
        }
    }

    for (const token of canvas?.tokens?.placeables ?? []) {
        if (token.actor?.type === "character" && !token.document?.actorLink) {
            try {
                token.actor.reset();
            } catch { /* ignore */ }
        }
    }

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
        try {
            app.render({ force: false });
        } catch {
            try {
                app.render();
            } catch { /* ignore */ }
        }
    }
}

/**
 * Extract the levels already present in the standard `ancestry` FeatGroup so we never
 * duplicate levels beyond the official extra 1st-level Ancestry Paragon feat.
 *
 * @param {object} ancestryGroup - Existing PF2e `ancestry` FeatGroup
 * @param {Actor} actor
 * @returns {Set<number>}
 */
function getExistingAncestrySlotLevels(ancestryGroup, actor) {
    const levels = new Set();

    // Check live slots on the ancestry FeatGroup first (may be a plain Object, Array, or Map/Collection)
    const rawSlots = ancestryGroup?.slots;
    if (rawSlots) {
        let slotList = [];
        if (Array.isArray(rawSlots)) {
            slotList = rawSlots;
        } else if (typeof rawSlots.values === "function") {
            slotList = Array.from(rawSlots.values());
        } else if (typeof rawSlots === "object") {
            slotList = Object.values(rawSlots);
        }

        for (const slot of slotList) {
            const lvl = Number(slot?.level ?? slot?.label);
            if (Number.isFinite(lvl) && lvl > 0) levels.add(lvl);
        }
    }

    // Fallback to class ancestryFeatLevels if slots didn't expose numeric levels
    if (levels.size === 0) {
        const raw = actor?.class?.system?.ancestryFeatLevels?.value
            ?? actor?.class?.system?.ancestryFeatLevels
            ?? [1, 5, 9, 13, 17];
        if (Array.isArray(raw)) {
            for (const v of raw) {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) levels.add(n);
            }
        }
    }

    return levels;
}

/**
 * Compute the Ancestry Paragon bonus slot levels for an actor at their current level.
 * Standard PF2e characters (ancestry feats at 1, 5, 9, 13, 17) receive Paragon slots at:
 * [1, 3, 7, 11, 15, 19] (filtered to <= actor.level).
 *
 * @param {Actor} actor
 * @param {object} [ancestryGroup]
 * @returns {number[]}
 */
export function getAncestryParagonSlotLevels(actor, ancestryGroup = null) {
    const actorLevel = Number(actor?.level ?? actor?.system?.details?.level?.value ?? 1);
    const existingLevels = getExistingAncestrySlotLevels(ancestryGroup ?? actor?.feats?.get("ancestry"), actor);

    const paragonLevels = [];
    // Always grant the extra 1st-level Ancestry Feat
    if (actorLevel >= 1) {
        paragonLevels.push(1);
    }
    // Grant every odd level not already provided by standard ancestry feat progression
    for (const lvl of ALL_ODD_LEVELS) {
        if (lvl <= actorLevel && !existingLevels.has(lvl)) {
            paragonLevels.push(lvl);
        }
    }

    return paragonLevels;
}

/* ------------------------------------------------------------------------- */
/* 3. FEAT GROUP INJECTION & LIFECYCLE WRAPPERS                              */
/* ------------------------------------------------------------------------- */

/**
 * Inject the native `ancestryparagon` FeatGroup into `actor.feats` right below `ancestry`.
 *
 * @param {Collection} featsCollection - `actor.feats` (CharacterFeats instance)
 */
function injectAncestryParagonFeatGroup(featsCollection) {
    if (!isAncestryParagonEnabled()) return;
    const actor = featsCollection?.actor;
    if (!actor || actor.type !== "character") return;

    // Avoid duplicating if another module (e.g., PF2e Workbench) already created an ancestry paragon group
    if (featsCollection.has("ancestryParagon") || featsCollection.has("ancestry-paragon")) {
        return;
    }

    const ancestryGroup = featsCollection.get("ancestry");
    const sampleGroup = ancestryGroup ?? featsCollection.values().next().value;
    const FeatGroupClass = sampleGroup?.constructor;
    if (!FeatGroupClass) return;

    const slotLevels = getAncestryParagonSlotLevels(actor, ancestryGroup);
    if (slotLevels.length === 0) return;

    // Clone the exact Compendium Browser filter & supported categories from the character's
    // native `ancestry` FeatGroup (automatically includes ancestry + versatile heritage traits!).
    const featFilter = Array.isArray(ancestryGroup?.featFilter)
        ? [...ancestryGroup.featFilter]
        : ["category-ancestry"];
    const supported = Array.isArray(ancestryGroup?.supported)
        ? [...ancestryGroup.supported]
        : ["ancestry"];

    const paragonGroup = new FeatGroupClass(actor, {
        id: PARAGON_GROUP_ID,
        label: "Ancestry Paragon Feats",
        featFilter,
        supported,
        slots: slotLevels
    });

    // Position immediately after the standard "ancestry" group on the Feats tab
    const orderedEntries = [];
    let inserted = false;
    for (const [key, value] of featsCollection.entries()) {
        if (key === PARAGON_GROUP_ID) continue;
        orderedEntries.push([key, value]);
        if (key === "ancestry") {
            orderedEntries.push([PARAGON_GROUP_ID, paragonGroup]);
            inserted = true;
        }
    }
    if (!inserted) {
        orderedEntries.push([PARAGON_GROUP_ID, paragonGroup]);
    }

    featsCollection.clear();
    for (const [key, value] of orderedEntries) {
        featsCollection.set(key, value);
    }
}

/**
 * Wrap `CharacterFeats.prototype.assignToSlots` once so the Ancestry Paragon feat group
 * is registered before PF2e assigns embedded feats into slots.
 *
 * @param {Actor} actor
 */
function ensureAncestryParagonFeatsWrapped(actor) {
    if (featsPrototypeWrapped) return;
    const featsProto = actor?.feats ? Object.getPrototypeOf(actor.feats) : null;
    if (!featsProto || typeof featsProto.assignToSlots !== "function") return;

    const originalAssignToSlots = featsProto.assignToSlots;
    featsProto.assignToSlots = function (...args) {
        try {
            injectAncestryParagonFeatGroup(this);
        } catch (err) {
            console.error("PF2e Awesome Variant Rules | Error preparing Ancestry Paragon feat group:", err);
        }
        return originalAssignToSlots.apply(this, args);
    };

    featsPrototypeWrapped = true;
}

/**
 * Fallback at end of `prepareDerivedData` in case `assignToSlots` wasn't intercepted.
 *
 * @param {Actor} actor
 */
function ensureAncestryParagonFallback(actor) {
    if (!isAncestryParagonEnabled()) return;
    if (!actor || actor.type !== "character") return;
    if (!actor.feats) return;
    if (actor.feats.has(PARAGON_GROUP_ID) || actor.feats.has("ancestryParagon") || actor.feats.has("ancestry-paragon")) {
        return;
    }

    try {
        injectAncestryParagonFeatGroup(actor.feats);
        const paragonGroup = actor.feats.get(PARAGON_GROUP_ID);
        if (paragonGroup && typeof paragonGroup.assignFeat === "function") {
            for (const feat of actor.itemTypes?.feat ?? []) {
                const loc = feat.system?.location;
                if (typeof loc === "string" && loc.startsWith(`${PARAGON_GROUP_ID}-`)) {
                    paragonGroup.assignFeat(feat);
                }
            }
        }
    } catch (err) {
        console.warn("PF2e Awesome Variant Rules | Ancestry Paragon feat group fallback failed:", err);
    }
}

/**
 * Install prototype wrappers on `CharacterPF2e` once on ready.
 */
function installAncestryParagonWrappers() {
    if (wrappersInstalled) return;

    const CharacterClass = CONFIG.PF2E?.Actor?.documentClasses?.character ?? CONFIG.Actor?.documentClass;
    if (!CharacterClass?.prototype) {
        console.warn("PF2e Awesome Variant Rules | Could not locate CharacterPF2e class for Ancestry Paragon.");
        return;
    }

    const proto = CharacterClass.prototype;

    if (typeof proto.prepareEmbeddedDocuments === "function") {
        const originalPrepareEmbedded = proto.prepareEmbeddedDocuments;
        proto.prepareEmbeddedDocuments = function (...args) {
            const result = originalPrepareEmbedded.apply(this, args);
            if (this.type === "character" && isAncestryParagonEnabled()) {
                try {
                    if (this.rollOptions?.all) {
                        this.rollOptions.all["variant:ancestry-paragon"] = true;
                    }
                    ensureAncestryParagonFeatsWrapped(this);
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Ancestry Paragon prepareEmbeddedDocuments error:`, err);
                }
            }
            return result;
        };
    }

    if (typeof proto.prepareDerivedData === "function") {
        const originalDerived = proto.prepareDerivedData;
        proto.prepareDerivedData = function (...args) {
            const result = originalDerived.apply(this, args);
            if (this.type === "character" && isAncestryParagonEnabled()) {
                try {
                    ensureAncestryParagonFallback(this);
                } catch (err) {
                    console.error(`PF2e Awesome Variant Rules | Ancestry Paragon prepareDerivedData error:`, err);
                }
            }
            return result;
        };
    }

    wrappersInstalled = true;
}

/* ------------------------------------------------------------------------- */
/* 4. INITIALIZATION                                                         */
/* ------------------------------------------------------------------------- */

export function initAncestryParagon() {
    installAncestryParagonWrappers();

    if (isAncestryParagonEnabled() && game.actors) {
        for (const actor of game.actors) {
            if (actor.type === "character") {
                try {
                    actor.reset();
                } catch (err) {
                    console.warn(`PF2e Awesome Variant Rules | Initial Ancestry Paragon reset failed for ${actor.name}:`, err);
                }
            }
        }
    }

    console.log("PF2e Awesome Variant Rules | Ancestry Paragon Variant Rule Initialized.");
}
