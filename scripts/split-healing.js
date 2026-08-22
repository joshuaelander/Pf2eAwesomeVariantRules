/**
 * PF2e Awesome Variant Rules: Alternate / Split Healing Dice (Min 1d3)
 * 
 * Variant Rule:
 * When rolling healing spells, impulses, Treat Wounds, Battle Medicine, or other recovery effects,
 * replace any die dX with twice as many dice of half the size (e.g. 1d8 -> 2d4, 1d6 -> 2d3, 1d12 -> 2d6),
 * down to a minimum resulting die size of d3.
 */

import { convertDiceFormula, convertItemSystemData, transformDamageObject } from './dice-utils.js';

const MODULE_ID = "pf2e-awesome-variant-rules";
const MIN_HEALING_FACE = 3;

export function convertHealingDiceFormula(formula) {
    return convertDiceFormula(formula, { minFace: MIN_HEALING_FACE });
}

export async function rollSplitHealingFormula(formula, { actor = null, flavor = "Split Dice Healing" } = {}) {
    const splitFormula = convertHealingDiceFormula(formula);
    const DamageRoll = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") ?? CONFIG.Dice.DamageRoll ?? Roll;

    try {
        const roll = new DamageRoll(`(${splitFormula})[healing,vitality]`);
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${flavor}</strong> (${splitFormula})`
        });
    } catch {
        const roll = new Roll(splitFormula);
        await roll.evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${flavor}</strong> (${splitFormula})`
        });
    }
}

export function registerSplitHealingCardButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        const isEnabled = game.settings.get(MODULE_ID, "splitHealingEnabled");
        if (!isEnabled) return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        const spellHealingBtns = root.querySelectorAll('button[data-action="spell-healing"], button[data-action="spellHealing"]');
        for (const btn of spellHealingBtns) {
            if (!btn.nextElementSibling?.classList.contains('pf2e-split-healing-btn')) {
                injectSpellHealingButton(btn, message);
            }
        }

        const impulseHealingBtns = root.querySelectorAll([
            'button[data-action="heal"]',
            'button[data-action="healing"]',
            'button[data-action="impulse-healing"]',
            'button[data-action="impulse-damage"]'
        ].join(", "));

        for (const btn of impulseHealingBtns) {
            if (!btn.nextElementSibling?.classList.contains('pf2e-split-healing-btn')) {
                injectImpulseHealingButton(btn, message);
            }
        }

        injectTreatWoundsHealingButton(root, message);
    });
}

function injectSpellHealingButton(healingBtn, message) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = `${healingBtn.className} pf2e-split-healing-btn`.trim();
    splitBtn.setAttribute("data-action", healingBtn.getAttribute("data-action"));
    splitBtn.innerHTML = `<i class="fa-solid fa-heart-pulse"></i> Split Dice Healing`;
    splitBtn.title = "Roll healing replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, 1d6 \u2192 2d3, min d3)";

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemUuid = message.flags?.pf2e?.origin?.uuid;
        let spell = itemUuid ? fromUuidSync(itemUuid) : message.item;

        if (!spell) {
            ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source spell for this roll.");
            return;
        }

        const castLevelAttr = healingBtn.getAttribute("data-cast-level") ?? healingBtn.dataset.castLevel;
        const castLevel = castLevelAttr ? parseInt(castLevelAttr, 10) : (
            message.flags?.pf2e?.casting?.castLevel
            ?? message.flags?.pf2e?.context?.castLevel
            ?? spell.rank
            ?? spell.level
        );

        const overlayIdsAttr = healingBtn.getAttribute("data-overlay-ids")
            ?? healingBtn.getAttribute("data-overlay-id")
            ?? healingBtn.dataset.overlayIds;

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
            convertItemSystemData(spellSource.system, { minFace: MIN_HEALING_FACE });

            // HARDCODE: Inject the 2-Action modifier directly into the base formula string
            if (spell.name === "Heal" && is2Action) {
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
                    transformDamageObject(damage, { minFace: MIN_HEALING_FACE });
                }
                return damage;
            };

            await tempSpell.rollDamage({ event, castLevel, overlayIds, options });
        } catch (err) {
            console.error("PF2e Awesome Variant Rules | Error rolling split dice:", err);
            ui.notifications.error("Failed to roll split dice. See console for details.");
        }
    });

    healingBtn.insertAdjacentElement("afterend", splitBtn);
}

function injectImpulseHealingButton(actionBtn, message) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = `${actionBtn.className} pf2e-split-healing-btn`.trim();
    splitBtn.setAttribute("data-action", actionBtn.getAttribute("data-action"));
    splitBtn.innerHTML = `<i class="fa-solid fa-seedling"></i> Split Dice Impulse`;
    splitBtn.title = "Roll impulse replacing dice with twice as many half-sized dice (e.g. 1d8 \u2192 2d4, 1d6 \u2192 2d3, min d3)";

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemUuid = message.flags?.pf2e?.origin?.uuid;
        let item = itemUuid ? fromUuidSync(itemUuid) : message.item;

        if (!item) {
            ui.notifications.warn("PF2e Awesome Variant Rules | Could not find source impulse/action for this roll.");
            return;
        }

        try {
            const itemSource = foundry.utils.deepClone(item._source ?? item.toObject());
            convertItemSystemData(itemSource.system, { minFace: MIN_HEALING_FACE });

            const tempItem = item.clone(itemSource, { keepId: true });

            if (typeof tempItem.rollDamage === "function") {
                await tempItem.rollDamage({ event });
            } else if (typeof tempItem.rollHealing === "function") {
                await tempItem.rollHealing({ event });
            } else if (typeof tempItem.roll === "function") {
                await tempItem.roll({ event });
            }
        } catch (err) {
            console.error("PF2e Awesome Variant Rules | Error rolling split impulse:", err);
            ui.notifications.error("Failed to roll split impulse. See console for details.");
        }
    });

    actionBtn.insertAdjacentElement("afterend", splitBtn);
}

function injectTreatWoundsHealingButton(root, message) {
    if (root.querySelector('.pf2e-split-healing-btn[data-action="split-treat-wounds"]')) return;

    const context = message.flags?.pf2e?.context;
    const isTreatWounds = context?.action === "treat-wounds"
        || context?.action === "battle-medicine"
        || message.flavor?.toLowerCase().includes("treat wounds")
        || message.flavor?.toLowerCase().includes("battle medicine")
        || root.textContent?.includes("Treat Wounds")
        || root.textContent?.includes("Battle Medicine");

    const item = message.item;
    const isHealingConsumable = item?.type === "consumable" &&
        (item.system.traits?.value?.includes("healing") || item.system.consumableType?.value === "potion" || item.system.consumableType?.value === "elixir");

    if (!isTreatWounds && !isHealingConsumable) return;

    const inlineDamageLinks = root.querySelectorAll('a.inline-roll, span[data-damage-formula], span.damage-roll, button[data-action="treat-wounds-healing"]');

    let matchedFormula = null;
    if (inlineDamageLinks.length > 0) {
        for (const el of inlineDamageLinks) {
            const formula = el.getAttribute("data-formula") || el.getAttribute("data-damage-formula") || el.textContent.trim();
            if (formula && /(\d+)?d\d+/i.test(formula)) {
                matchedFormula = formula;
                break;
            }
        }
    }

    if (!matchedFormula) {
        const text = root.textContent || "";
        const isCrit = text.includes("Critical Success") || context?.outcome === "criticalSuccess";
        const isSuccess = text.includes("Success") || context?.outcome === "success";

        if (isCrit) {
            if (text.includes("+ 50") || text.includes("+50")) matchedFormula = "4d8 + 50";
            else if (text.includes("+ 30") || text.includes("+30")) matchedFormula = "4d8 + 30";
            else if (text.includes("+ 10") || text.includes("+10")) matchedFormula = "4d8 + 10";
            else matchedFormula = "4d8";
        } else if (isSuccess) {
            if (text.includes("+ 50") || text.includes("+50")) matchedFormula = "2d8 + 50";
            else if (text.includes("+ 30") || text.includes("+30")) matchedFormula = "2d8 + 30";
            else if (text.includes("+ 10") || text.includes("+10")) matchedFormula = "2d8 + 10";
            else matchedFormula = "2d8";
        }
    }

    if (!matchedFormula) return;

    const targetContainer = root.querySelector('.card-buttons, footer, .message-content') ?? root;

    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = "pf2e-split-healing-btn";
    splitBtn.setAttribute("data-action", "split-treat-wounds");
    splitBtn.style.marginTop = "6px";
    splitBtn.style.width = "100%";
    splitBtn.innerHTML = `<i class="fa-solid fa-notes-medical"></i> Split Treat Wounds`;
    splitBtn.title = `Roll Treat Wounds with split dice (${matchedFormula} \u2192 ${convertHealingDiceFormula(matchedFormula)})`;

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await rollSplitHealingFormula(matchedFormula, {
            actor: message.actor,
            flavor: "Treat Wounds / Recovery (Split Dice)"
        });
    });

    targetContainer.appendChild(splitBtn);
}