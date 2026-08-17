/**
 * PF2e Awesome Variant Rules: Alternate / Split Spell Damage Dice
 * 
 * Variant Rule:
 * When rolling spell damage, replace any damage die dX with twice as many dice of half the size
 * (e.g. 1d8 -> 2d4, 1d12 -> 2d6), provided the resulting die is at least d4 (minimum die size).
 * Dice smaller than d8 (such as d6 and d4) cannot be split because d3/d2 are smaller than d4.
 */

const MODULE_ID = "pf2e-awesome-variant-rules";

/**
 * Converts a formula string by replacing eligible dice with split dice.
 * Minimum resulting die face is 4 (d4).
 * 
 * Examples:
 *  - "1d8" -> "2d4"
 *  - "2d8 + 4" -> "4d4 + 4"
 *  - "1d12[fire] + 2d6[cold]" -> "2d6[fire] + 2d6[cold]"
 *  - "3d6" -> "3d6" (unchanged, 6/2 = 3 < 4)
 *  - "1d4" -> "1d4" (unchanged, 4/2 = 2 < 4)
 * 
 * @param {string} formula
 * @returns {string} Converted formula
 */
export function convertSpellDiceFormula(formula) {
    if (!formula || typeof formula !== "string") return formula;

    return formula.replace(/(\d+)?d(\d+)/gi, (match, countStr, facesStr) => {
        const count = countStr ? parseInt(countStr, 10) : 1;
        const faces = parseInt(facesStr, 10);

        // Only split if faces / 2 is an integer and >= 4 (d4 minimum)
        if (faces % 2 === 0 && (faces / 2) >= 4) {
            const newCount = count * 2;
            const newFaces = faces / 2;
            return `${newCount}d${newFaces}`;
        }
        return match;
    });
}

/**
 * Converts damage formulas inside a Spell document's system data.
 * Modifies base damage, interval heightening, and fixed-level heightening.
 * 
 * @param {object} systemData - Spell system data object
 */
export function convertSpellSystemData(systemData) {
    if (!systemData) return;

    // 1. Base damage entries (e.g. system.damage[0].formula)
    if (systemData.damage && typeof systemData.damage === "object") {
        for (const [key, dmg] of Object.entries(systemData.damage)) {
            if (typeof dmg === "string") {
                systemData.damage[key] = convertSpellDiceFormula(dmg);
            } else if (dmg && typeof dmg === "object") {
                if (dmg.formula) {
                    dmg.formula = convertSpellDiceFormula(dmg.formula);
                }
                if (dmg.value) {
                    dmg.value = convertSpellDiceFormula(dmg.value);
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
                    systemData.heightening.damage[key] = convertSpellDiceFormula(dmg);
                } else if (dmg && typeof dmg === "object") {
                    if (dmg.formula) {
                        dmg.formula = convertSpellDiceFormula(dmg.formula);
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
                            levelData.damage[key] = convertSpellDiceFormula(dmg);
                        } else if (dmg && typeof dmg === "object") {
                            if (dmg.formula) {
                                dmg.formula = convertSpellDiceFormula(dmg.formula);
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Fallback transformation of damage objects/instances in PF2e damage data.
 * @param {object} damage - The damage object returned by spell.getDamage()
 */
export function transformDamageObject(damage) {
    if (!damage) return damage;

    // Transform template damage instances (PF2e standard format)
    const instances = damage.template?.damage?.instances;
    if (instances && typeof instances.values === "function") {
        for (const instance of instances.values()) {
            if (instance.formula) {
                instance.formula = convertSpellDiceFormula(instance.formula);
            }
            if (instance.base?.formula) {
                instance.base.formula = convertSpellDiceFormula(instance.base.formula);
            }
            if (instance._formula) {
                instance._formula = convertSpellDiceFormula(instance._formula);
            }
        }
    }

    // Transform top-level formula if present
    if (damage.formula) {
        damage.formula = convertSpellDiceFormula(damage.formula);
    }
    if (damage.template?.damage?.formula) {
        damage.template.damage.formula = convertSpellDiceFormula(damage.template.damage.formula);
    }

    return damage;
}

/**
 * Injects the "Split Dice Damage" button onto spell chat cards.
 */
export function registerSplitDamageCardButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        // Check module setting
        const isEnabled = game.settings.get(MODULE_ID, "splitSpellDamageEnabled");
        if (!isEnabled) return;

        // Ensure compatibility with both HTMLElement (Foundry v13/v14 AppV2) and jQuery
        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        // Check if message has a spell damage or healing button
        const actionBtn = root.querySelector([
            'button[data-action="spell-damage"]',
            'button[data-action="spellDamage"]',
            'button[data-action="spell-healing"]',
            'button[data-action="spellHealing"]'
        ].join(", "));

        if (!actionBtn) return;

        // Prevent duplicate buttons on re-render
        if (root.querySelector('.pf2e-split-damage-btn')) return;

        // Determine button label and icon based on damage vs healing
        const actionType = actionBtn.getAttribute("data-action") || "";
        const isHealing = actionType.toLowerCase().includes("heal");
        const actionLabel = isHealing ? "Split Dice Healing" : "Split Dice Damage";
        const iconClass = isHealing ? "fa-solid fa-heart-pulse" : "fa-solid fa-dice-d6";

        // Create the Split Dice button matching native PF2e button classes
        const splitBtn = document.createElement("button");
        splitBtn.type = "button";
        splitBtn.className = `${actionBtn.className} pf2e-split-damage-btn`.trim();
        splitBtn.setAttribute("data-action", "split-spell-damage");
        splitBtn.innerHTML = `<i class="${iconClass}"></i> ${actionLabel}`;
        splitBtn.title = "Roll replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, min d4)";

        // Handle click event
        splitBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const itemUuid = message.flags?.pf2e?.origin?.uuid;
            let spell = null;

            if (itemUuid) {
                spell = fromUuidSync(itemUuid);
            }
            if (!spell && message.item) {
                spell = message.item;
            }

            if (!spell) {
                ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source spell for this roll.");
                return;
            }

            // Retrieve cast level / rank from message context
            const castLevel = message.flags?.pf2e?.casting?.castLevel 
                ?? message.flags?.pf2e?.context?.castLevel 
                ?? spell.rank 
                ?? spell.level;

            // Overlay IDs if applicable (e.g. modal options or variant choices)
            const overlayIds = message.flags?.pf2e?.casting?.overlayIds;

            try {
                // Clone the spell with converted system damage and heightening data
                const spellSource = foundry.utils.deepClone(spell._source ?? spell.toObject());
                convertSpellSystemData(spellSource.system);

                const tempSpell = spell.clone(spellSource, { keepId: true });

                // Also wrap tempSpell.getDamage as a safety net for instances/synthetics
                const originalGetDamage = tempSpell.getDamage.bind(tempSpell);
                tempSpell.getDamage = function(params) {
                    const damage = originalGetDamage(params);
                    if (damage) {
                        transformDamageObject(damage);
                    }
                    return damage;
                };

                // Execute the native PF2e damage roll with all context and heightening preserved
                await tempSpell.rollDamage({
                    event,
                    castLevel,
                    overlayIds
                });
            } catch (err) {
                console.error("PF2e Awesome Variant Rules | Error rolling split spell damage:", err);
                ui.notifications.error("Failed to roll split spell damage. See console for details.");
            }
        });

        // Insert the button directly after the original damage/healing button
        actionBtn.insertAdjacentElement("afterend", splitBtn);
    });
}
