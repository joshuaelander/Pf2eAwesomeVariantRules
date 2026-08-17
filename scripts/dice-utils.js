/**
 * PF2e Awesome Variant Rules: Shared Dice & Formula Utilities
 */

/**
 * Converts a formula string by replacing eligible dice with twice as many dice of half the size.
 * 
 * @param {string} formula - The dice formula string (e.g. "1d8 + 4", "2d6[vitality]")
 * @param {object} options
 * @param {number} [options.minFace=4] - Minimum resulting face size (e.g. 4 for damage: min d4; 3 for healing: min d3)
 * @returns {string} Converted formula
 */
export function convertDiceFormula(formula, { minFace = 4 } = {}) {
    if (!formula || typeof formula !== "string") return formula;

    return formula.replace(/(\d+)?d(\d+)/gi, (match, countStr, facesStr) => {
        const count = countStr ? parseInt(countStr, 10) : 1;
        const faces = parseInt(facesStr, 10);

        // Split if faces is even and faces / 2 >= minFace
        if (faces % 2 === 0 && (faces / 2) >= minFace) {
            const newCount = count * 2;
            const newFaces = faces / 2;
            return `${newCount}d${newFaces}`;
        }
        return match;
    });
}

/**
 * Converts damage and healing formulas inside an Item/Spell/Feat/Action system data object.
 * Recursively updates base damage entries, interval heightening, fixed level heightening,
 * overlays (e.g. 2-action Heal "+8"), variants, and rule elements.
 * 
 * @param {object} systemData - Item system data object
 * @param {object} options
 * @param {number} [options.minFace=4] - Minimum resulting face size
 */
export function convertItemSystemData(systemData, { minFace = 4 } = {}) {
    if (!systemData || typeof systemData !== "object") return;

    // 1. Base damage/healing entries (e.g. system.damage[0].formula)
    if (systemData.damage && typeof systemData.damage === "object") {
        for (const [key, dmg] of Object.entries(systemData.damage)) {
            if (typeof dmg === "string") {
                systemData.damage[key] = convertDiceFormula(dmg, { minFace });
            } else if (dmg && typeof dmg === "object") {
                if (dmg.formula) {
                    dmg.formula = convertDiceFormula(dmg.formula, { minFace });
                }
                if (dmg.value) {
                    dmg.value = convertDiceFormula(dmg.value, { minFace });
                }
            }
        }
    }

    // 2. Heightening entries
    if (systemData.heightening) {
        // Interval heightening (e.g. system.heightening.damage[0] = "1d8")
        if (systemData.heightening.damage && typeof systemData.heightening.damage === "object") {
            for (const [key, dmg] of Object.entries(systemData.heightening.damage)) {
                if (typeof dmg === "string") {
                    systemData.heightening.damage[key] = convertDiceFormula(dmg, { minFace });
                } else if (dmg && typeof dmg === "object") {
                    if (dmg.formula) {
                        dmg.formula = convertDiceFormula(dmg.formula, { minFace });
                    }
                }
            }
        }
        // Fixed rank heightening (e.g. system.heightening.levels[3].damage[0].formula)
        if (systemData.heightening.levels && typeof systemData.heightening.levels === "object") {
            for (const levelData of Object.values(systemData.heightening.levels)) {
                if (levelData?.damage && typeof levelData.damage === "object") {
                    for (const [key, dmg] of Object.entries(levelData.damage)) {
                        if (typeof dmg === "string") {
                            levelData.damage[key] = convertDiceFormula(dmg, { minFace });
                        } else if (dmg && typeof dmg === "object") {
                            if (dmg.formula) {
                                dmg.formula = convertDiceFormula(dmg.formula, { minFace });
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Overlays / Variants (e.g. 2-action Heal "+8", Harm variants, etc.)
    if (systemData.overlays && typeof systemData.overlays === "object") {
        for (const overlay of Object.values(systemData.overlays)) {
            if (overlay?.system) {
                convertItemSystemData(overlay.system, { minFace });
            }
        }
    }
    if (systemData.variants && typeof systemData.variants === "object") {
        for (const variant of Object.values(systemData.variants)) {
            if (variant?.system) {
                convertItemSystemData(variant.system, { minFace });
            }
        }
    }

    // 4. Rule Elements formulas if any exist
    if (Array.isArray(systemData.rules)) {
        for (const rule of systemData.rules) {
            if (rule && typeof rule === "object") {
                if (typeof rule.value === "string") {
                    rule.value = convertDiceFormula(rule.value, { minFace });
                }
                if (typeof rule.formula === "string") {
                    rule.formula = convertDiceFormula(rule.formula, { minFace });
                }
                if (typeof rule.damage === "string") {
                    rule.damage = convertDiceFormula(rule.damage, { minFace });
                }
            }
        }
    }
}

/**
 * Fallback transformation of damage objects/instances in PF2e damage data structures.
 * 
 * @param {object} damage - The damage object returned by getDamage()
 * @param {object} options
 * @param {number} [options.minFace=4] - Minimum resulting face size
 */
export function transformDamageObject(damage, { minFace = 4 } = {}) {
    if (!damage) return damage;

    // Transform template damage instances (PF2e standard format)
    const instances = damage.template?.damage?.instances;
    if (instances && typeof instances.values === "function") {
        for (const instance of instances.values()) {
            if (instance.formula) {
                instance.formula = convertDiceFormula(instance.formula, { minFace });
            }
            if (instance.base?.formula) {
                instance.base.formula = convertDiceFormula(instance.base.formula, { minFace });
            }
            if (instance._formula) {
                instance._formula = convertDiceFormula(instance._formula, { minFace });
            }
        }
    }

    // Transform top-level formula if present
    if (damage.formula) {
        damage.formula = convertDiceFormula(damage.formula, { minFace });
    }
    if (damage.template?.damage?.formula) {
        damage.template.damage.formula = convertDiceFormula(damage.template.damage.formula, { minFace });
    }

    return damage;
}
