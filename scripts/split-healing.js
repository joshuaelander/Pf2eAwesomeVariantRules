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

export async function rollSplitHealingFormula(formula, { actor = null, flavor = "Split Dice Healing", item = null, rollMode = null, bonus = 0 } = {}) {
    let splitFormula = convertHealingDiceFormula(formula);
    if (bonus && typeof bonus === "number" && bonus !== 0) {
        splitFormula = bonus > 0 ? `${splitFormula} + ${bonus}` : `${splitFormula} - ${Math.abs(bonus)}`;
    }

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

    const targetRollMode = rollMode || game.settings.get("core", "rollMode") || "publicroll";

    try {
        const roll = new DamageRoll(rollFormula);
        await roll.evaluate();
        await roll.toMessage(messageData, { rollMode: targetRollMode });
    } catch (err) {
        console.warn("PF2e Awesome Variant Rules | DamageRoll evaluation failed, falling back to standard Roll:", err);
        const roll = new Roll(splitFormula);
        await roll.evaluate();
        await roll.toMessage(messageData, { rollMode: targetRollMode });
    }
}

/**
 * Helper to safely extract and localize roll mode options across Foundry VTT versions.
 */
function getRollModeOptions(currentRollMode = "publicroll") {
    const defaultModes = {
        publicroll: "Public Roll",
        gmroll: "Private GM Roll",
        blindroll: "Blind GM Roll",
        selfroll: "Self Roll"
    };

    const modes = {};
    const rawModes = CONFIG.Dice?.rollModes;

    if (rawModes && typeof rawModes === "object") {
        for (const [key, val] of Object.entries(rawModes)) {
            let label = "";
            if (typeof val === "string") {
                if (typeof game.i18n?.localize === "function" && val.includes(".")) {
                    try {
                        label = game.i18n.localize(val);
                    } catch {
                        label = val;
                    }
                } else {
                    label = val;
                }
            } else if (val && typeof val === "object" && typeof val.label === "string") {
                if (typeof game.i18n?.localize === "function" && val.label.includes(".")) {
                    try {
                        label = game.i18n.localize(val.label);
                    } catch {
                        label = val.label;
                    }
                } else {
                    label = val.label;
                }
            }
            modes[key] = label || defaultModes[key] || String(key);
        }
    }

    const finalModes = Object.keys(modes).length > 0 ? modes : defaultModes;
    let html = "";
    for (const [key, label] of Object.entries(finalModes)) {
        const selected = key === currentRollMode ? "selected" : "";
        html += `<option value="${key}" ${selected}>${label}</option>`;
    }
    return html;
}

/**
 * Prompts a confirmation/roll dialog for Split Dice on impulses, potions, elixirs, and recovery actions.
 * Displays original vs. split formula, allows situational bonus input and roll mode selection.
 * Fast-forwards directly to rolling if Shift-clicked.
 */
export async function promptSplitHealingDialog(originalFormula, { actor = null, flavor = "Split Dice Healing", item = null, event = null } = {}) {
    // If Shift-click was used, fast-forward directly to rolling
    if (event?.shiftKey) {
        return rollSplitHealingFormula(originalFormula, { actor, flavor, item });
    }

    try {
        const splitFormula = convertHealingDiceFormula(originalFormula);
        const sourceName = item?.name || (flavor.replace(" (Split Dice)", "").replace("Treat Wounds / ", "")) || "Healing / Recovery";
        const itemImg = item?.img || "icons/magic/life/cross-area-circle-green-white.webp";

        let currentRollMode = "publicroll";
        try {
            currentRollMode = game.settings?.get("core", "rollMode") || "publicroll";
        } catch {
            currentRollMode = "publicroll";
        }

        const rollModeOptions = getRollModeOptions(currentRollMode);

        const dialogContent = `
        <div class="pf2e dialog-content" style="font-family: var(--sans-serif, 'Signika', sans-serif); padding: 4px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.15); padding-bottom: 8px;">
                <img src="${itemImg}" width="36" height="36" style="border: 1px solid #7a7971; border-radius: 4px; object-fit: cover;" />
                <div>
                    <h3 style="margin: 0; font-family: var(--serif, 'Palatino Linotype', serif); font-weight: bold; font-size: 15px;">${sourceName}</h3>
                    <div style="font-size: 12px; color: #555;">Split Healing Dice (Min d3)</div>
                </div>
            </div>

            <div style="background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.12); border-radius: 6px; padding: 8px; margin-bottom: 12px; text-align: center;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 4px;">Dice Formula</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: bold;">
                    <span style="color: #777; text-decoration: line-through;">${originalFormula}</span>
                    <span style="color: #4b4a44;">&rarr;</span>
                    <span style="color: #1a7f37; background: #dafbe1; padding: 2px 8px; border-radius: 4px; border: 1px solid #b4eec4;">${splitFormula}</span>
                </div>
            </div>

            <div class="form-group" style="margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                <label style="font-weight: bold; font-size: 13px; flex: 1;">Situational Bonus:</label>
                <input type="number" id="split-healing-bonus" style="width: 80px; text-align: center; padding: 4px; border: 1px solid #7a7971; border-radius: 3px;" placeholder="+0" value="0" />
            </div>

            <div class="form-group" style="margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                <label style="font-weight: bold; font-size: 13px; flex: 1;">Roll Mode:</label>
                <select id="split-healing-roll-mode" style="flex: 1.5; padding: 4px; border: 1px solid #7a7971; border-radius: 3px;">
                    ${rollModeOptions}
                </select>
            </div>
        </div>
        `;

        return new Promise((resolve) => {
            new Dialog({
                title: `✨ Split Dice: ${sourceName}`,
                content: dialogContent,
                buttons: {
                    roll: {
                        icon: '<i class="fas fa-dice-d20"></i>',
                        label: "Roll Healing",
                        callback: async (html) => {
                            const bonus = parseInt(html.find('#split-healing-bonus').val(), 10) || 0;
                            const rollMode = html.find('#split-healing-roll-mode').val() || currentRollMode;
                            const result = await rollSplitHealingFormula(originalFormula, {
                                actor,
                                flavor,
                                item,
                                rollMode,
                                bonus
                            });
                            resolve(result);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "roll"
            }, { width: 380 }).render(true);
        });
    } catch (err) {
        console.error("PF2e Awesome Variant Rules | Error opening Split Healing dialog:", err);
        return rollSplitHealingFormula(originalFormula, { actor, flavor, item });
    }
}

export const triggerNativeInlineDamageRoll = promptSplitHealingDialog;

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
    if (root.querySelector('.pf2e-split-healing-btn, .pf2e-split-damage-btn')) return;

    const context = message.flags?.pf2e?.context;
    const itemUuid = message.flags?.pf2e?.origin?.uuid;
    const item = message.item || (itemUuid ? fromUuidSync(itemUuid) : null);

    // Spells are handled via the unified spell dice button injector in split-spell-damage.js
    if (item?.type === "spell" || message.flags?.pf2e?.origin?.type === "spell" || message.flags?.pf2e?.casting) return;

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
        'button[data-action="treat-wounds-healing"]',
        'button[data-action="damage"]',
        'button[data-action="healing"]',
        'button[data-action="heal"]'
    ].join(', '));

    for (const el of inlineElements) {
        const raw = el.dataset?.damageFormula || el.dataset?.formula || el.getAttribute("data-damage-formula") || el.getAttribute("data-formula") || el.textContent;
        if (raw && /\d+d\d+/i.test(raw)) {
            const cleaned = raw.replace(/\[.*?\]/g, "").replace(/[()]/g, "").trim();
            const diceMatch = cleaned.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/i);
            if (diceMatch) {
                matchedFormula = diceMatch[1].trim();
                break;
            }
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

    // Fallback: search for dice patterns in card text
    if (!matchedFormula) {
        const textDiceMatch = combinedText.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/i);
        if (textDiceMatch) {
            matchedFormula = textDiceMatch[1].trim();
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
    const targetContainer = root.querySelector('.card-buttons, footer, .card-content, .message-content') ?? root;

    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = "pf2e-split-healing-btn";
    splitBtn.setAttribute("data-action", "split-inline-healing");
    splitBtn.style.marginTop = "6px";
    splitBtn.style.width = "100%";

    // UNIFIED AESTHETIC
    splitBtn.innerHTML = `Split Dice`;
    splitBtn.title = `Roll with split dice (${matchedFormula} \u2192 ${convertedFormula}, min d3) - Shift-click to skip dialog`;

    splitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await promptSplitHealingDialog(matchedFormula, {
            actor: message.actor,
            flavor: flavorText,
            item: item,
            event: event
        });
    });

    targetContainer.appendChild(splitBtn);
}