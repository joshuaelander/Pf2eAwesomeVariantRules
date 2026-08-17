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
 * Recursively or structurally transforms damage objects/instances in PF2e damage data.
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

        // Check if message has a spell damage button
        const damageBtn = root.querySelector('button[data-action="spell-damage"], button[data-action="spellDamage"]');
        if (!damageBtn) return;

        // Prevent duplicate buttons on re-render
        if (root.querySelector('.pf2e-split-damage-btn')) return;

        // Create the Split Dice Damage button
        const splitBtn = document.createElement("button");
        splitBtn.type = "button";
        splitBtn.className = "pf2e-split-damage-btn";
        splitBtn.setAttribute("data-action", "split-spell-damage");
        splitBtn.innerHTML = `<i class="fa-solid fa-dice-d6"></i> Split Dice Damage`;
        splitBtn.title = "Roll damage replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, min d4)";
        splitBtn.style.marginTop = "4px";

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

            // Temporarily intercept getDamage during spell.rollDamage to modify the formulas cleanly
            const originalGetDamage = spell.getDamage.bind(spell);
            try {
                spell.getDamage = function(params) {
                    const damage = originalGetDamage(params);
                    if (damage) {
                        transformDamageObject(damage);
                    }
                    return damage;
                };

                // Execute the native PF2e damage roll with all context preserved
                await spell.rollDamage({
                    event,
                    castLevel,
                    overlayIds
                });
            } catch (err) {
                console.error("PF2e Awesome Variant Rules | Error rolling split spell damage:", err);
                ui.notifications.error("Failed to roll split spell damage. See console for details.");
            } finally {
                // Restore original method
                spell.getDamage = originalGetDamage;
            }
        });

        // Insert the button directly after the original damage button
        damageBtn.insertAdjacentElement("afterend", splitBtn);
    });
}
