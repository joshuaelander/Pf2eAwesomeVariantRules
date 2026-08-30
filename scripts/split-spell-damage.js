/**
 * PF2e Awesome Variant Rules: Alternate / Split Spell Dice
 * 
 * Variant Rule:
 * When rolling spell damage or healing, replace any die dX with twice as many dice of half the size
 * (e.g. 1d8 -> 2d4, 1d12 -> 2d6, 1d6 -> 2d3 for healing), down to the minimum resulting die size:
 * - Minimum d4 for spell damage
 * - Minimum d3 for spell healing
 */

import { convertDiceFormula, convertItemSystemData, transformDamageObject, getSpellCategory } from './dice-utils.js';

const MODULE_ID = "pf2e-awesome-variant-rules";
const MIN_DAMAGE_FACE = 4;   // Minimum die size is d4 for spell damage
const MIN_HEALING_FACE = 3;  // Minimum die size is d3 for spell healing

export function convertSpellDiceFormula(formula, { isHealing = false } = {}) {
    const minFace = isHealing ? MIN_HEALING_FACE : MIN_DAMAGE_FACE;
    return convertDiceFormula(formula, { minFace });
}

export function registerSplitDamageCardButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        // Prevent adding buttons to the actual dice roll result cards!
        if (message.isRoll || (message.rolls && message.rolls.length > 0)) return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        const damageBtns = root.querySelectorAll('button[data-action="spell-damage"], button[data-action="spellDamage"], button[data-action="spell-healing"], button[data-action="spellHealing"]');
        for (const damageBtn of damageBtns) {
            if (damageBtn.nextElementSibling?.classList.contains('pf2e-split-damage-btn') ||
                damageBtn.nextElementSibling?.classList.contains('pf2e-split-healing-btn')) {
                continue;
            }

            const itemUuid = message.flags?.pf2e?.origin?.uuid;
            let spell = itemUuid ? fromUuidSync(itemUuid) : message.item;

            // Classify spell and verify relevant setting
            const category = getSpellCategory(spell);
            const damageEnabled = Boolean(game.settings.get(MODULE_ID, "splitSpellDamageEnabled"));
            const healingEnabled = Boolean(game.settings.get(MODULE_ID, "splitHealingEnabled"));

            let isEnabled = false;
            let minFace = MIN_DAMAGE_FACE;

            if (category === "both") {
                // Heal and Harm show if either setting is enabled
                isEnabled = damageEnabled || healingEnabled;
                minFace = healingEnabled ? MIN_HEALING_FACE : MIN_DAMAGE_FACE;
            } else if (category === "healing") {
                // Pure healing spells (e.g. Soothe) only show if healing setting is enabled
                isEnabled = healingEnabled;
                minFace = MIN_HEALING_FACE;
            } else {
                // Pure damage spells only show if damage setting is enabled
                isEnabled = damageEnabled;
                minFace = MIN_DAMAGE_FACE;
            }

            if (!isEnabled) continue;

            injectSpellSplitButton(damageBtn, message, { spell, minFace, category });
        }
    });
}

function injectSpellSplitButton(damageBtn, message, { spell = null, minFace = MIN_DAMAGE_FACE, category = "damage" } = {}) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    const btnClass = category === "healing" ? "pf2e-split-healing-btn" : "pf2e-split-damage-btn";
    splitBtn.className = `${damageBtn.className} ${btnClass}`.trim();
    splitBtn.setAttribute("data-action", "split-spell-dice");

    // UNIFIED AESTHETIC
    splitBtn.innerHTML = `Split Dice`;
    splitBtn.title = minFace === MIN_HEALING_FACE
        ? "Roll healing replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, 1d6 \u2192 2d3, min d3)"
        : "Roll damage replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, 1d12 \u2192 2d6, min d4)";

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemUuid = message.flags?.pf2e?.origin?.uuid;
        let currentSpell = spell || (itemUuid ? fromUuidSync(itemUuid) : message.item);

        if (!currentSpell) {
            ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source spell for this roll.");
            return;
        }

        const castLevelAttr = damageBtn.getAttribute("data-cast-level") ?? damageBtn.dataset.castLevel;
        const castLevel = castLevelAttr ? parseInt(castLevelAttr, 10) : (
            message.flags?.pf2e?.casting?.castLevel
            ?? message.flags?.pf2e?.context?.castLevel
            ?? currentSpell.rank
            ?? currentSpell.level
        );

        const overlayIdsAttr = damageBtn.getAttribute("data-overlay-ids")
            ?? damageBtn.getAttribute("data-overlay-id")
            ?? damageBtn.dataset.overlayIds;

        let overlayIds = overlayIdsAttr ? overlayIdsAttr.split(",").map(s => s.trim()).filter(Boolean) : undefined;

        if (!overlayIds || overlayIds.length === 0) {
            overlayIds = message.flags?.pf2e?.casting?.overlayIds
                ?? message.flags?.pf2e?.context?.overlayIds
                ?? message.flags?.pf2e?.origin?.variant?.overlayIds;
        }

        if (Array.isArray(overlayIds)) {
            overlayIds = overlayIds.filter(id => typeof id === "string");
        }

        if (typeof currentSpell.loadVariant === "function" && overlayIds && overlayIds.length > 0) {
            currentSpell = currentSpell.loadVariant({ overlayIds }) ?? currentSpell;
        }

        try {
            const options = [...(message.flags?.pf2e?.context?.options ?? [])];

            // Action detection fallback
            const is1Action = options.includes("item:cast:actions:1");
            const is3Action = options.includes("item:cast:actions:3");
            const is2Action = !is1Action && !is3Action;

            if (is2Action && !options.includes("item:cast:actions:2")) {
                options.push("item:cast:actions:2");
            }

            const spellSource = foundry.utils.deepClone(currentSpell.toObject());
            convertItemSystemData(spellSource.system, { minFace });

            // Inject the 2-Action modifier directly into the base formula string for Harm/Heal
            if (["Heal", "Harm"].includes(currentSpell.name) && is2Action) {
                const bonus = 8 * castLevel;
                if (spellSource.system.damage && typeof spellSource.system.damage === "object") {
                    const firstKey = Object.keys(spellSource.system.damage)[0];
                    if (firstKey && spellSource.system.damage[firstKey].formula) {
                        const existingFormula = spellSource.system.damage[firstKey].formula;
                        if (!existingFormula.includes(`+ ${bonus}`) && !existingFormula.includes(`+${bonus}`)) {
                            spellSource.system.damage[firstKey].formula += ` + ${bonus}`;
                        }
                    }
                }
            }

            const tempSpell = currentSpell.clone(spellSource, { keepId: true });

            const originalGetDamage = tempSpell.getDamage.bind(tempSpell);
            tempSpell.getDamage = function (params) {
                const damage = originalGetDamage(params);
                if (damage) {
                    transformDamageObject(damage, { minFace });
                }
                return damage;
            };

            await tempSpell.rollDamage({ event, castLevel, overlayIds, options });
        } catch (err) {
            console.error("PF2e Awesome Variant Rules | Error rolling split dice:", err);
            ui.notifications.error("Failed to roll split dice. See console for details.");
        }
    });

    damageBtn.insertAdjacentElement("afterend", splitBtn);
}