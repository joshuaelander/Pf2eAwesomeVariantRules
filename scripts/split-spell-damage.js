/**
 * PF2e Awesome Variant Rules: Alternate / Split Spell Damage Dice
 * 
 * Variant Rule:
 * When rolling spell damage, replace any damage die dX with twice as many dice of half the size
 * (e.g. 1d8 -> 2d4, 1d12 -> 2d6), provided the resulting die is at least d4 (minimum die size).
 * Dice smaller than d8 (such as d6 and d4) cannot be split because d3/d2 are smaller than d4.
 */

import { convertDiceFormula, convertItemSystemData, transformDamageObject } from './dice-utils.js';

const MODULE_ID = "pf2e-awesome-variant-rules";
const MIN_FACE = 4; // Minimum die size is d4 for spell damage

/**
 * Converts a formula string for spell damage (minimum d4).
 * @param {string} formula
 * @returns {string}
 */
export function convertSpellDiceFormula(formula) {
    return convertDiceFormula(formula, { minFace: MIN_FACE });
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

        // Target spell damage buttons specifically (healing spells are handled in split-healing.js)
        const damageBtns = root.querySelectorAll('button[data-action="spell-damage"], button[data-action="spellDamage"]');
        for (const damageBtn of damageBtns) {
            if (!damageBtn.nextElementSibling?.classList.contains('pf2e-split-damage-btn')) {
                injectSpellDamageButton(damageBtn, message);
            }
        }
    });
}

/**
 * Injects split damage button after a specific spell damage button.
 */
function injectSpellDamageButton(damageBtn, message) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = `${damageBtn.className} pf2e-split-damage-btn`.trim();
    splitBtn.setAttribute("data-action", "split-spell-damage");
    splitBtn.innerHTML = `<i class="fa-solid fa-dice-d6"></i> Split Dice Damage`;
    splitBtn.title = "Roll damage replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, min d4)";

    // Handle click event
    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemUuid = message.flags?.pf2e?.origin?.uuid;
        let spell = itemUuid ? fromUuidSync(itemUuid) : message.item;

        if (!spell) {
            ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source spell for this roll.");
            return;
        }

        // Retrieve cast level / rank from button attribute or message context
        const castLevelAttr = damageBtn.getAttribute("data-cast-level") ?? damageBtn.dataset.castLevel;
        const castLevel = castLevelAttr ? parseInt(castLevelAttr, 10) : (
            message.flags?.pf2e?.casting?.castLevel 
            ?? message.flags?.pf2e?.context?.castLevel 
            ?? spell.rank 
            ?? spell.level
        );

        // Overlay IDs if applicable (e.g. Harm 1/2/3 action variants)
        const overlayIdsAttr = damageBtn.getAttribute("data-overlay-ids") 
            ?? damageBtn.getAttribute("data-overlay-id") 
            ?? damageBtn.dataset.overlayIds;
        let overlayIds = overlayIdsAttr ? overlayIdsAttr.split(",").map(s => s.trim()).filter(Boolean) : undefined;
        if (!overlayIds || overlayIds.length === 0) {
            overlayIds = message.flags?.pf2e?.casting?.overlayIds 
                ?? message.flags?.pf2e?.context?.overlayIds
                ?? (message.flags?.pf2e?.origin?.variant ? [message.flags.pf2e.origin.variant] : undefined);
        }

        try {
            // Clone the spell with converted system damage, heightening, and overlays data (min d4)
            const spellSource = foundry.utils.deepClone(spell._source ?? spell.toObject());
            convertItemSystemData(spellSource.system, { minFace: MIN_FACE });

            const tempSpell = spell.clone(spellSource, { keepId: true });

            // Wrap tempSpell.getDamage as a safety net for instances/synthetics
            const originalGetDamage = tempSpell.getDamage.bind(tempSpell);
            tempSpell.getDamage = function(params) {
                const damage = originalGetDamage(params);
                if (damage) {
                    transformDamageObject(damage, { minFace: MIN_FACE });
                }
                return damage;
            };

            // Execute the native PF2e damage roll
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

    // Insert the button directly after the original damage button
    damageBtn.insertAdjacentElement("afterend", splitBtn);
}
