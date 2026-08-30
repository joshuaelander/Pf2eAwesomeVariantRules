/**
 * PF2e Awesome Variant Rules: Alternate / Split Healing Dice (Min 1d3)
 * 
 * Variant Rule:
 * When rolling healing spells, impulses, Treat Wounds, Battle Medicine, or other recovery effects,
 * replace any die dX with twice as many dice of half the size (e.g. 1d8 -> 2d4, 1d6 -> 2d3, 1d12 -> 2d6),
 * down to a minimum resulting die size of d3.
 */

import { convertDiceFormula, isHealingEffect } from './dice-utils.js';

const MODULE_ID = "pf2e-awesome-variant-rules";
const MIN_HEALING_FACE = 3;

export function convertHealingDiceFormula(formula) {
    return convertDiceFormula(formula, { minFace: MIN_HEALING_FACE });
}

export async function rollSplitHealingFormula(formula, { actor = null, flavor = "Split Dice Healing", item = null } = {}) {
    const splitFormula = convertHealingDiceFormula(formula);
    const DamageRoll = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") ?? CONFIG.Dice.DamageRoll ?? Roll;

    // Clean formula and ensure healing bracket tag for PF2e DamageRoll
    let rollFormula = splitFormula.trim();
    if (!rollFormula.includes("[")) {
        rollFormula = `(${splitFormula})[healing]`;
    }

    // Build the message data, tying it back to the source item's UUID so UI displays its icon & traits
    const messageData = {
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>${flavor}</strong> (${splitFormula})`,
        flags: {
            pf2e: {
                origin: item ? { uuid: item.uuid, type: item.type } : null
            }
        }
    };

    try {
        const roll = new DamageRoll(rollFormula);
        await roll.evaluate();
        await roll.toMessage(messageData);
    } catch (err) {
        console.warn("PF2e Awesome Variant Rules | DamageRoll evaluation failed, falling back to standard Roll:", err);
        const roll = new Roll(splitFormula);
        await roll.evaluate();
        await roll.toMessage(messageData);
    }
}

export function registerSplitHealingCardButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        const isEnabled = game.settings.get(MODULE_ID, "splitHealingEnabled");
        if (!isEnabled) return;

        // Prevent adding buttons to actual dice roll result cards
        if (message.isRoll || (message.rolls && message.rolls.length > 0)) return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        // Handles Impulses (Ocean's Balm, Fresh Produce), Consumables (Potions, Elixirs), Treat Wounds, and Feats
        injectInlineHealingButton(root, message);
    });
}

/**
 * Dynamically handles Impulses (Ocean's Balm, Fresh Produce), Consumables (Potions/Elixirs),
 * Treat Wounds, Battle Medicine, and Feats.
 */
function injectInlineHealingButton(root, message) {
    if (root.querySelector('.pf2e-split-healing-btn')) return;

    const context = message.flags?.pf2e?.context;
    const itemUuid = message.flags?.pf2e?.origin?.uuid;
    const item = message.item || (itemUuid ? fromUuidSync(itemUuid) : null);

    // Spells are handled via the unified spell dice button injector in split-spell-damage.js
    if (item?.type === "spell") return;

    const text = root.textContent || "";
    const flavor = message.flavor || "";
    const combinedText = `${text} ${flavor} ${item?.name || ""}`;

    // 1. Verify this card represents a healing/recovery effect
    const isHealing = isHealingEffect({ item, message, text: combinedText });

    // 2. Extract the Formula from inline rolls or text
    let matchedFormula = null;

    const inlineElements = root.querySelectorAll([
        '[data-damage-formula]',
        '[data-formula]',
        '.inline-roll',
        '.damage-roll',
        'a.inline-roll',
        'button[data-action="treat-wounds-healing"]'
    ].join(', '));

    for (const el of inlineElements) {
        const rawFormula = el.dataset?.damageFormula || el.dataset?.formula || el.getAttribute("data-damage-formula") || el.getAttribute("data-formula") || el.textContent.trim();
        // Match standard dice formulas like 1d8, 2d8+5, 1d6[vitality], 3d6+6
        const diceMatch = rawFormula.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/i);
        if (diceMatch) {
            matchedFormula = diceMatch[1];
            break;
        }
    }

    // Treat Wounds fallback formula calculation if not explicitly embedded as inline roll
    const isTreatWounds = context?.action === "treat-wounds"
        || context?.action === "battle-medicine"
        || combinedText.toLowerCase().includes("treat wounds")
        || combinedText.toLowerCase().includes("battle medicine");

    if (!matchedFormula && isTreatWounds) {
        const isCrit = combinedText.toLowerCase().includes("critical success") || context?.outcome === "criticalSuccess";
        const isSuccess = combinedText.toLowerCase().includes("success") || context?.outcome === "success";

        if (isCrit) {
            if (combinedText.includes("+ 50") || combinedText.includes("+50")) matchedFormula = "4d8 + 50";
            else if (combinedText.includes("+ 30") || combinedText.includes("+30")) matchedFormula = "4d8 + 30";
            else if (combinedText.includes("+ 10") || combinedText.includes("+10")) matchedFormula = "4d8 + 10";
            else matchedFormula = "4d8";
        } else if (isSuccess) {
            if (combinedText.includes("+ 50") || combinedText.includes("+50")) matchedFormula = "2d8 + 50";
            else if (combinedText.includes("+ 30") || combinedText.includes("+30")) matchedFormula = "2d8 + 30";
            else if (combinedText.includes("+ 10") || combinedText.includes("+10")) matchedFormula = "2d8 + 10";
            else matchedFormula = "2d8";
        }
    }

    // Gatekeeper: Must have a valid formula containing dice and be a recognized healing effect
    if (!matchedFormula || !/\d+d\d+/i.test(matchedFormula)) return;
    if (!isHealing && !isTreatWounds) return;

    // 3. Construct Split Button
    let flavorText = "Recovery (Split Dice)";
    if (isTreatWounds) {
        flavorText = "Treat Wounds / Recovery (Split Dice)";
    } else if (item?.name) {
        flavorText = `${item.name} (Split Dice)`;
    }

    const convertedFormula = convertHealingDiceFormula(matchedFormula);
    const targetContainer = root.querySelector('.card-buttons, footer, .message-content') ?? root;

    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = "pf2e-split-healing-btn";
    splitBtn.setAttribute("data-action", "split-inline-healing");
    splitBtn.style.marginTop = "6px";
    splitBtn.style.width = "100%";

    // UNIFIED AESTHETIC
    splitBtn.innerHTML = `Split Dice`;
    splitBtn.title = `Roll with split dice (${matchedFormula} \u2192 ${convertedFormula}, min d3)`;

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await rollSplitHealingFormula(matchedFormula, {
            actor: message.actor,
            flavor: flavorText,
            item: item
        });
    });

    targetContainer.appendChild(splitBtn);
}