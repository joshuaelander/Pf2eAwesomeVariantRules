/**
 * PF2e Awesome Variant Rules: Alternate / Split Spell Damage Dice
 * 
 * Variant Rule:
 * When rolling spell damage, replace any damage die dX with twice as many dice of half the size
 * (e.g. 1d8 -> 2d4, 1d12 -> 2d6), provided the resulting die is at least d4 (minimum die size).
 */

import { convertDiceFormula, convertItemSystemData, transformDamageObject } from './dice-utils.js';

const MODULE_ID = "pf2e-awesome-variant-rules";
const MIN_FACE = 4; // Minimum die size is d4 for spell damage

export function convertSpellDiceFormula(formula) {
    return convertDiceFormula(formula, { minFace: MIN_FACE });
}

export function registerSplitDamageCardButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        const isEnabled = game.settings.get(MODULE_ID, "splitSpellDamageEnabled");
        if (!isEnabled) return;

        // NEW FIX: Prevent adding buttons to the actual dice roll result cards!
        if (message.isRoll || (message.rolls && message.rolls.length > 0)) return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        const damageBtns = root.querySelectorAll('button[data-action="spell-damage"], button[data-action="spellDamage"]');
        for (const damageBtn of damageBtns) {
            if (!damageBtn.nextElementSibling?.classList.contains('pf2e-split-damage-btn')) {
                injectSpellDamageButton(damageBtn, message);
            }
        }
    });
}

function injectSpellDamageButton(damageBtn, message) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = `${damageBtn.className} pf2e-split-damage-btn`.trim();
    splitBtn.setAttribute("data-action", "split-spell-damage");

    // UNIFIED AESTHETIC
    splitBtn.innerHTML = `Split Dice`;
    splitBtn.title = "Roll damage replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, min d4)";

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemUuid = message.flags?.pf2e?.origin?.uuid;
        let spell = itemUuid ? fromUuidSync(itemUuid) : message.item;

        if (!spell) {
            ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source spell for this roll.");
            return;
        }

        const castLevelAttr = damageBtn.getAttribute("data-cast-level") ?? damageBtn.dataset.castLevel;
        const castLevel = castLevelAttr ? parseInt(castLevelAttr, 10) : (
            message.flags?.pf2e?.casting?.castLevel
            ?? message.flags?.pf2e?.context?.castLevel
            ?? spell.rank
            ?? spell.level
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

        if (typeof spell.loadVariant === "function" && overlayIds && overlayIds.length > 0) {
            spell = spell.loadVariant({ overlayIds }) ?? spell;
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

            const spellSource = foundry.utils.deepClone(spell.toObject());
            convertItemSystemData(spellSource.system, { minFace: MIN_FACE });

            // HARDCODE: Inject the 2-Action modifier directly into the base formula string for Harm/Heal vs Undead
            if (["Heal", "Harm"].includes(spell.name) && is2Action) {
                const bonus = 8 * castLevel;
                if (spellSource.system.damage && typeof spellSource.system.damage === "object") {
                    const firstKey = Object.keys(spellSource.system.damage)[0];
                    if (firstKey && spellSource.system.damage[firstKey].formula) {
                        spellSource.system.damage[firstKey].formula += ` + ${bonus}`;
                    }
                }
            }

            const tempSpell = spell.clone(spellSource, { keepId: true });

            const originalGetDamage = tempSpell.getDamage.bind(tempSpell);
            tempSpell.getDamage = function (params) {
                const damage = originalGetDamage(params);
                if (damage) {
                    transformDamageObject(damage, { minFace: MIN_FACE });
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