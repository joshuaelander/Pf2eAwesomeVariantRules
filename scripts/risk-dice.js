/**
 * PF2e Awesome Variant Rules: Risk Dice (Tension Dice)
 * 
 * Mechanics:
 * - A cumulative pool of Risk Dice (d6) builds as the party takes risky, loud, or time-consuming actions.
 * - When "Take a Risk" is triggered:
 *     1. Current dice count increases by 1.
 *     2. Rolls Nd6 (where N is the new count).
 *     3. Dice roll results are whispered secretly to the Game Master (Blind GM Roll).
 *     4. If ANY die rolls a 1 (or configured target number):
 *        - A Complication is triggered!
 *        - The dice count automatically resets to 0.
 *        - The GM sees all 1s prominently highlighted.
 *     5. If NO dice roll a 1:
 *        - Safe! Tension builds.
 *        - The dice count remains at N for the next risk.
 * - Players can trigger "Take a Risk" via macro; the world state and rolls are synchronized via sockets to the GM.
 * - The GM can see and manage the current dice count at any time via:
 *     1. Floating HUD widget on screen.
 *     2. Scene Control button on the left toolbar.
 *     3. "Risk Dice Manager" macro / dialog.
 */

export const MODULE_ID = "pf2e-awesome-variant-rules";
export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const TAKE_RISK_MACRO_NAME = "Take a Risk";
export const TAKE_RISK_MACRO_ICON = "icons/sundries/gaming/dice-runed-brown.webp";

export const RISK_MANAGER_MACRO_NAME = "Risk Dice Manager";
export const RISK_MANAGER_MACRO_ICON = "icons/sundries/gaming/dice-pair-white-green.webp";

export const ROLL_COMPLICATION_MACRO_NAME = "Roll Complication";
export const ROLL_COMPLICATION_MACRO_ICON = "icons/sundries/gaming/game-magic-eight-ball.webp";

/* ------------------------------------------------------------------------- */
/* 1. SETTINGS REGISTRATION                                                  */
/* ------------------------------------------------------------------------- */

export function registerRiskDiceSettings() {
    game.settings.register(MODULE_ID, "riskDiceEnabled", {
        name: "Enable Risk Dice Variant",
        hint: "Enables the Risk Dice (Tension Dice) pool mechanic where taking risky actions increases dice count and rolls for complications.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            updateRiskDiceHUD();
            setTimeout(() => {
                if (ui.controls?.rendered) ui.controls.render();
            }, 0);
        }
    });

    game.settings.register(MODULE_ID, "riskDiceCount", {
        name: "Current Risk Dice Count",
        hint: "Internal world counter for the current number of Risk Dice.",
        scope: "world",
        config: false,
        type: Number,
        default: 0,
        onChange: (newCount) => {
            updateRiskDiceHUD(newCount);
            if (ui.controls?.rendered) ui.controls.render();
            updateOpenManagerDialog(newCount);
        }
    });

    game.settings.register(MODULE_ID, "riskDiceDieFaces", {
        name: "Risk Die Type",
        hint: "The type of die rolled for Risk Dice (standard is d6).",
        scope: "world",
        config: true,
        type: Number,
        choices: {
            4: "d4",
            6: "d6",
            8: "d8",
            10: "d10",
            12: "d12",
            20: "d20"
        },
        default: 6
    });

    game.settings.register(MODULE_ID, "riskDiceTargetNumber", {
        name: "Complication Number",
        hint: "Rolling this number on any risk die triggers a complication (standard is 1).",
        scope: "world",
        config: true,
        type: Number,
        default: 1
    });

    game.settings.register(MODULE_ID, "riskDiceResetOnComplication", {
        name: "Reset Pool on Complication",
        hint: "Automatically reset the Risk Dice count to 0 when a complication occurs.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "riskDicePublicAnnouncement", {
        name: "Announce Risk in Public Chat",
        hint: "Posts a public chat card notifying players that a risk was taken and the current dice count, while the roll result is whispered secretly to the GM.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "riskDiceShowHud", {
        name: "Show Risk Dice HUD",
        hint: "Display an on-screen widget showing current Risk Dice and quick controls (shows pool count or '?' based on GM settings).",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            updateRiskDiceHUD();
            if (ui.controls?.rendered) ui.controls.render();
        }
    });

    game.settings.register(MODULE_ID, "riskDicePlayerCanSeeRoll", {
        name: "Players Can See Dice Roll",
        hint: "Allow players to see the risk dice roll results and outcome card in chat. When enabled, the result card is shown publicly to all players instead of being whispered secretly to the Game Master.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "riskDicePlayerCanSeeCount", {
        name: "Players Can See Dice Count",
        hint: "Allow players to see the current Risk Dice count in public announcements and HUD widget. If unchecked, players see '?' instead.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            updateRiskDiceHUD();
        }
    });

    // --- Complication Table Settings ---
    game.settings.register(MODULE_ID, "riskDiceComplicationTableEnabled", {
        name: "Enable Complication Roll Table",
        hint: "When a complication occurs, enables rolling on a d20 complication table to determine the consequence.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "riskDiceComplicationFormula", {
        name: "Complication Die Formula",
        hint: "The dice formula to roll on the complication table (standard is 1d20).",
        scope: "world",
        config: true,
        type: String,
        default: "1d20"
    });

    game.settings.register(MODULE_ID, "riskDiceComplicationTableEntries", {
        name: "Complication Table Ranges",
        hint: "Define outcomes by roll range (min-max: outcome), separated by semicolons or new lines. Example: 1-15: Random Encounter; 16-20: Party sustains an injury",
        scope: "world",
        config: true,
        type: String,
        default: "1-10: Wandering Monsters / Hostile Patrol\n11-15: Environmental Hazard or Structural Cave-in\n16-18: Lost Time & Resource Depletion (Torches burn out, rations spoiled)\n19-20: Party sustains an Injury or Condition (Fatigued, Clumsy 1, etc.)"
    });

    game.settings.register(MODULE_ID, "riskDiceComplicationRollTable", {
        name: "Use Foundry RollTable (Optional)",
        hint: "Name or UUID of an existing Foundry RollTable to draw from instead of the text ranges above. Leave blank to use the text ranges.",
        scope: "world",
        config: true,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "riskDiceComplicationPublic", {
        name: "Show Complication Result to Players",
        hint: "If enabled, complication roll results are shown publicly to all players. If disabled, results are secret to the GM.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
}

/* ------------------------------------------------------------------------- */
/* 2. STATE ACCESSORS & HELPERS                                              */
/* ------------------------------------------------------------------------- */

export function isRiskDiceEnabled() {
    return Boolean(game.settings.get(MODULE_ID, "riskDiceEnabled"));
}

export function getRiskDiceCount() {
    return Math.max(0, parseInt(game.settings.get(MODULE_ID, "riskDiceCount"), 10) || 0);
}

export async function setRiskDiceCount(count) {
    const safeCount = Math.max(0, parseInt(count, 10) || 0);

    if (game.user.isGM) {
        await game.settings.set(MODULE_ID, "riskDiceCount", safeCount);
    } else {
        // Player requests GM to set count
        const activeGM = getPrimaryActiveGM();
        if (!activeGM) {
            ui.notifications.warn("Risk Dice: An active Game Master must be online to update Risk Dice.");
            return;
        }
        game.socket.emit(SOCKET_EVENT, {
            action: "setCount",
            count: safeCount
        });
    }
    return safeCount;
}

export async function resetRiskDice() {
    await setRiskDiceCount(0);
    ui.notifications.info("Risk Dice pool has been reset to 0.");
}

export async function modifyRiskDiceCount(delta) {
    const current = getRiskDiceCount();
    const updated = Math.max(0, current + delta);
    await setRiskDiceCount(updated);
    return updated;
}

export function getPrimaryActiveGM() {
    if (game.users?.activeGM) return game.users.activeGM;
    const activeGMs = game.users?.filter(u => u.isGM && (u.active || u.id === game.user.id)).sort((a, b) => a.id.localeCompare(b.id)) || [];
    return activeGMs[0] || game.users?.find(u => u.isGM && u.active) || null;
}

export function isPrimaryActiveGM() {
    if (!game.user?.isGM) return false;
    if (game.users?.activeGM) return game.users.activeGM.id === game.user.id;
    const activeGMs = game.users?.filter(u => u.isGM && (u.active || u.id === game.user.id)).sort((a, b) => a.id.localeCompare(b.id)) || [];
    return activeGMs.length === 0 || activeGMs[0]?.id === game.user.id;
}

/* ------------------------------------------------------------------------- */
/* 3. SOCKET HANDLING                                                        */
/* ------------------------------------------------------------------------- */

let socketsRegistered = false;

export function registerRiskDiceSockets() {
    if (socketsRegistered) return;
    if (!game.socket) return;
    socketsRegistered = true;

    game.socket.on(SOCKET_EVENT, async (data) => {
        if (!data || typeof data !== "object") return;

        // Only the designated primary GM executes authoritative changes
        if (!isPrimaryActiveGM()) return;

        console.log("PF2e Awesome Variant Rules | Risk Dice socket action received:", data.action, data);

        switch (data.action) {
            case "takeRisk":
                await executeRiskRoll({
                    reason: data.reason || "",
                    userId: data.userId,
                    actorId: data.actorId,
                    actorUuid: data.actorUuid
                });
                break;
            case "setCount":
                await setRiskDiceCount(data.count);
                break;
            case "rollCurrentPool":
                await executeCurrentPoolRoll({
                    reason: data.reason || "",
                    userId: data.userId
                });
                break;
            case "announceComplication":
                await announceComplicationToChat({
                    count: data.count,
                    reason: data.reason || ""
                });
                break;
            case "rollComplication":
                await rollComplication({
                    reason: data.reason || "",
                    userId: data.userId
                });
                break;
            case "announceComplicationResult":
                await announceComplicationResultToChat({
                    rollTotal: data.rollTotal,
                    text: data.text || ""
                });
                break;
            default:
                break;
        }
    });
}

/* ------------------------------------------------------------------------- */
/* 4. PLAYER / GM INTERACTION: TAKE A RISK                                   */
/* ------------------------------------------------------------------------- */

/**
 * Public function to trigger "Take a Risk".
 * Can be run from macro or UI.
 * Holding Shift prompts for an optional description/activity name.
 */
export async function takeRisk({ reason = "", actor = null, skipPrompt = false } = {}) {
    if (!isRiskDiceEnabled()) {
        ui.notifications.warn("Risk Dice variant is currently disabled in module settings.");
        return;
    }

    const selectedActor = actor ?? canvas.tokens.controlled[0]?.actor ?? game.user?.character ?? null;

    // Detect if Shift is held down (unless skipPrompt is explicitly set)
    const isShiftHeld = !skipPrompt && (
        game.keyboard?.isModifierActive?.(KeyboardManager?.MODIFIER_KEYS?.SHIFT) ||
        Boolean(window.event?.shiftKey)
    );

    let activityReason = reason;

    if (isShiftHeld && !reason) {
        activityReason = await promptRiskReasonDialog();
        if (activityReason === null) return; // User cancelled
    }

    if (game.user.isGM) {
        // Direct execution for GM
        await executeRiskRoll({
            reason: activityReason,
            userId: game.user.id,
            actorId: selectedActor?.id || null,
            actorUuid: selectedActor?.uuid || null
        });
    } else {
        // Player: delegate to active GM via socket
        const activeGM = getPrimaryActiveGM();
        if (!activeGM) {
            ui.notifications.warn("Risk Dice: An active Game Master must be online to resolve Risk Dice.");
            return;
        }

        game.socket.emit(SOCKET_EVENT, {
            action: "takeRisk",
            userId: game.user.id,
            actorId: selectedActor?.id || null,
            actorUuid: selectedActor?.uuid || null,
            reason: activityReason
        });

        const canSeeRoll = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeRoll"));
        if (canSeeRoll) {
            ui.notifications.info("Taking a Risk... rolling Risk Dice!");
        } else {
            ui.notifications.info("Taking a Risk... secret roll sent to the Game Master.");
        }
    }
}

/**
 * Dialog to input an optional reason when taking a risk.
 */
async function promptRiskReasonDialog() {
    return new Promise((resolve) => {
        let submitted = false;
        new Dialog({
            title: "Take a Risk",
            content: `
                <form style="padding: 5px;">
                    <p style="margin-bottom: 8px;"><strong>Taking a Risk:</strong> Adds 1 Risk Die and rolls for complications.</p>
                    <div style="margin-bottom: 10px;">
                        <label for="risk-reason-input" style="display: block; font-weight: bold; margin-bottom: 4px;">Activity / Reason (Optional):</label>
                        <input id="risk-reason-input" type="text" placeholder="e.g. Forcing the door, Searching the vault, Making loud noise" style="width: 100%; box-sizing: border-box;" autofocus />
                    </div>
                </form>
            `,
            buttons: {
                take: {
                    icon: '<i class="fa-solid fa-dice-d6"></i>',
                    label: "Take Risk",
                    callback: (html) => {
                        submitted = true;
                        const val = html.find("#risk-reason-input").val()?.trim() || "";
                        resolve(val);
                    }
                },
                cancel: {
                    icon: '<i class="fa-solid fa-times"></i>',
                    label: "Cancel",
                    callback: () => {
                        submitted = true;
                        resolve(null);
                    }
                }
            },
            default: "take",
            close: () => {
                if (!submitted) resolve(null);
            }
        }).render(true);
    });
}

/* ------------------------------------------------------------------------- */
/* 5. ROLL EXECUTION & CHAT CARDS                                            */
/* ------------------------------------------------------------------------- */

/**
 * Executes the authoritative Risk Roll (increments count, rolls secretly for GM).
 */
export async function executeRiskRoll({ reason = "", userId = game.user.id, actorId = null, actorUuid = null } = {}) {
    if (!isRiskDiceEnabled()) return;

    const oldCount = getRiskDiceCount();
    const newCount = oldCount + 1;

    // Update count setting
    await setRiskDiceCount(newCount);

    const dieFaces = game.settings.get(MODULE_ID, "riskDiceDieFaces") || 6;
    const targetNumber = game.settings.get(MODULE_ID, "riskDiceTargetNumber") || 1;
    const formula = `${newCount}d${dieFaces}`;

    const roll = new Roll(formula);
    await roll.evaluate();

    const triggeringUser = game.users.get(userId) || game.user;
    let actor = null;
    if (actorUuid) {
        try {
            const doc = fromUuidSync(actorUuid);
            actor = doc?.actor || doc;
        } catch {}
    }
    if (!actor && actorId) {
        actor = game.actors.get(actorId) || null;
    }
    if (!actor) {
        actor = triggeringUser.character || null;
    }
    const speaker = ChatMessage.getSpeaker({ actor: actor, user: triggeringUser });

    // Extract dice results
    const results = [];
    for (const term of roll.dice) {
        if (term.results) {
            for (const r of term.results) {
                results.push(r.result);
            }
        }
    }

    const complicationCount = results.filter(r => r === targetNumber).length;
    const isComplication = complicationCount > 0;
    const resetOnComplication = Boolean(game.settings.get(MODULE_ID, "riskDiceResetOnComplication"));

    // If complication, reset count back to 0
    if (isComplication && resetOnComplication) {
        await setRiskDiceCount(0);
    }

    const playersCanSeeRoll = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeRoll"));

    // 1. Post Public Announcement Card (only if the roll is kept secret to GM and announcement is enabled)
    const publicAnnouncement = Boolean(game.settings.get(MODULE_ID, "riskDicePublicAnnouncement"));
    if (!playersCanSeeRoll && publicAnnouncement) {
        await postPublicRiskCard({
            user: triggeringUser,
            actor,
            speaker,
            oldCount,
            newCount,
            dieFaces,
            reason
        });
    }

    // 2. Post Roll Result Card (public to all if playersCanSeeRoll is enabled, otherwise secret to GM)
    await postRiskRollCard({
        roll,
        user: triggeringUser,
        actor,
        speaker,
        oldCount,
        newCount,
        dieFaces,
        targetNumber,
        results,
        isComplication,
        complicationCount,
        reason,
        wasReset: isComplication && resetOnComplication,
        isPublic: playersCanSeeRoll
    });
}

/**
 * Allows the GM to roll the current pool without incrementing the count.
 */
export async function executeCurrentPoolRoll({ reason = "", userId = game.user.id } = {}) {
    if (!isRiskDiceEnabled()) return;

    const count = getRiskDiceCount();
    if (count <= 0) {
        ui.notifications.warn("Risk Dice pool is currently at 0. Take a risk to add dice to the pool!");
        return;
    }

    const dieFaces = game.settings.get(MODULE_ID, "riskDiceDieFaces") || 6;
    const targetNumber = game.settings.get(MODULE_ID, "riskDiceTargetNumber") || 1;
    const formula = `${count}d${dieFaces}`;

    const roll = new Roll(formula);
    await roll.evaluate();

    const triggeringUser = game.users.get(userId) || game.user;
    const speaker = ChatMessage.getSpeaker({ user: triggeringUser });

    const results = [];
    for (const term of roll.dice) {
        if (term.results) {
            for (const r of term.results) {
                results.push(r.result);
            }
        }
    }

    const complicationCount = results.filter(r => r === targetNumber).length;
    const isComplication = complicationCount > 0;
    const resetOnComplication = Boolean(game.settings.get(MODULE_ID, "riskDiceResetOnComplication"));

    if (isComplication && resetOnComplication) {
        await setRiskDiceCount(0);
    }

    const playersCanSeeRoll = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeRoll"));

    await postRiskRollCard({
        roll,
        user: triggeringUser,
        actor: null,
        speaker,
        oldCount: count,
        newCount: count,
        dieFaces,
        targetNumber,
        results,
        isComplication,
        complicationCount,
        reason: reason || "Manual Pool Roll",
        wasReset: isComplication && resetOnComplication,
        isPublic: playersCanSeeRoll
    });
}

/**
 * Posts the public announcement card visible to all players.
 */
async function postPublicRiskCard({ user, actor, speaker, oldCount, newCount, dieFaces, reason }) {
    const actorName = actor?.name || speaker.alias || user.name || "A player";
    const canSeeCount = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeCount"));

    const countDisplay = `<div class="risk-pool-status">
        <span>Risk Dice Pool:</span>
        <span class="risk-pool-badge">${canSeeCount ? `${newCount} ${newCount === 1 ? 'Die' : 'Dice'} (${newCount}d${dieFaces})` : `? Dice`}</span>
    </div>`;

    const reasonHtml = reason
        ? `<div class="risk-reason-box"><i class="fa-solid fa-quote-left"></i> ${reason}</div>`
        : "";

    const content = `
        <div class="pf2e-risk-card public">
            <div class="risk-card-header">
                <i class="fa-solid fa-dice-d6 header-icon"></i>
                <div class="header-titles">
                    <h3>Risk Taken!</h3>
                    <div class="subtitle">PF2e Risk Dice Variant</div>
                </div>
            </div>
            <div class="risk-card-body">
                <div><span class="risk-actor-tag">${actorName}</span> took a risky action!</div>
                ${reasonHtml}
                ${countDisplay}
                <div class="risk-secret-note">
                    <i class="fa-solid fa-eye-slash"></i>
                    <span>The dice have been rolled secretly for the Game Master...</span>
                </div>
            </div>
        </div>
    `;

    await ChatMessage.create({
        speaker: speaker,
        content: content
    });
}

/**
 * Posts the roll card (public or whispered to GM depending on isPublic).
 */
export async function postRiskRollCard({
    roll,
    user,
    actor,
    speaker,
    oldCount,
    newCount,
    dieFaces,
    targetNumber,
    results,
    isComplication,
    complicationCount,
    reason,
    wasReset,
    isPublic = false
}) {
    const actorName = actor?.name || speaker.alias || user.name || "Someone";

    // Format individual dice results with badges and complication highlights
    const diceHtml = results.map(val => {
        const isComp = (val === targetNumber);
        if (isComp) {
            return `<div class="risk-die complication" title="Complication! Rolled ${val}"><i class="fa-solid fa-skull"></i><span>${val}</span></div>`;
        }
        return `<div class="risk-die safe" title="Safe">${val}</div>`;
    }).join("");

    const reasonHtml = reason
        ? `<div class="risk-reason-box"><i class="fa-solid fa-quote-left"></i> ${reason}</div>`
        : "";

    let outcomeBanner = "";
    if (isComplication) {
        const compTableEnabled = Boolean(game.settings.get(MODULE_ID, "riskDiceComplicationTableEnabled"));
        const rollCompBtn = compTableEnabled ? `
            <button type="button" class="risk-roll-complication-btn" data-action="roll-complication" data-reason="${escapeHtml(reason)}">
                <i class="fa-solid fa-dice-d20"></i> Roll Complication Table
            </button>
        ` : "";

        // Only show "Announce Complication to Players" button if the roll card was secret
        const announceBtn = !isPublic ? `
            <button type="button" class="risk-announce-btn" data-action="announce-complication" data-count="${newCount}" data-reason="${escapeHtml(reason)}">
                <i class="fa-solid fa-bullhorn"></i> Announce Complication to Players
            </button>
        ` : "";

        outcomeBanner = `
            <div class="risk-banner danger">
                <h4><i class="fa-solid fa-triangle-exclamation"></i> COMPLICATION TRIGGERED!</h4>
                <p>Rolled <strong>${complicationCount}</strong> complication ${complicationCount === 1 ? 'die' : 'dice'} (face ${targetNumber})!</p>
                <p>Something bad happens or conditions escalate.</p>
                ${wasReset ? '<p style="margin-top:4px;"><em>Risk Dice counter automatically reset to <strong>0</strong>.</em></p>' : ''}
                ${rollCompBtn}
                ${announceBtn}
            </div>
        `;
    } else {
        outcomeBanner = `
            <div class="risk-banner safe">
                <h4><i class="fa-solid fa-shield-halved"></i> SAFE - NO COMPLICATION</h4>
                <p>No ${targetNumber}s rolled. The tension mounts...</p>
                <p>Risk Dice pool remains at <strong>${newCount}</strong> dice.</p>
            </div>
        `;
    }

    const cardClass = isPublic ? "public" : "gm-secret";
    const secretBadge = !isPublic ? `<div class="risk-secret-badge"><i class="fa-solid fa-eye-slash"></i> GM Secret Roll</div>` : "";

    const content = `
        <div class="pf2e-risk-card ${cardClass}">
            <div class="risk-card-header">
                <i class="fa-solid fa-dice-d6 header-icon"></i>
                <div class="header-titles">
                    <h3>Risk Dice Roll (${newCount}d${dieFaces})</h3>
                    <div class="subtitle">Triggered by ${actorName}</div>
                </div>
                ${secretBadge}
            </div>
            <div class="risk-card-body">
                ${reasonHtml}
                <div class="risk-dice-container">
                    ${diceHtml}
                </div>
                ${outcomeBanner}
            </div>
        </div>
    `;

    const gmRecipients = ChatMessage.getWhisperRecipients("GM").map(u => u.id);

    await ChatMessage.create({
        speaker: speaker,
        content: content,
        flavor: `Risk Dice Roll (${newCount}d${dieFaces})`,
        rolls: [roll],
        whisper: isPublic ? [] : gmRecipients,
        blind: !isPublic
    });
}

// Backward-compatibility alias
export const postGMRiskRollCard = postRiskRollCard;

/**
 * Publicly announces to chat that a complication has erupted.
 */
export async function announceComplicationToChat({ count = 0, reason = "" } = {}) {
    const reasonHtml = reason ? `<div class="risk-reason-box"><i class="fa-solid fa-quote-left"></i> ${reason}</div>` : "";
    const poolInfo = count > 0 ? ` (accumulated pool of ${count} dice)` : "";

    const content = `
        <div class="pf2e-risk-card public" style="border-color: #b82d2d; background: linear-gradient(135deg, #2b1414 0%, #170d0d 100%);">
            <div class="risk-card-header">
                <i class="fa-solid fa-skull-crossbones header-icon" style="color: #ff5252;"></i>
                <div class="header-titles">
                    <h3 style="color: #ff9191;">The Tension Snaps!</h3>
                    <div class="subtitle">Risk Dice Complication</div>
                </div>
            </div>
            <div class="risk-card-body">
                <div style="font-size: 1.05em; font-weight: bold; color: #ffcccc; margin-bottom: 6px;">
                    ⚠️ A complication occurs!
                </div>
                <div>The pressure and accumulated danger have boiled over${poolInfo}. Something hazardous or hostile takes place!</div>
                ${reasonHtml}
                <div class="risk-pool-status" style="margin-top: 8px;">
                    <span>Risk Dice Pool:</span>
                    <span class="risk-pool-badge" style="background: #2b1111; border-color: #ff6e6e; color: #ffc2c2;">Reset to 0</span>
                </div>
            </div>
        </div>
    `;

    await ChatMessage.create({
        speaker: { alias: "Risk Dice" },
        content: content
    });
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------------- */
/* 5b. COMPLICATION ROLL TABLE                                               */
/* ------------------------------------------------------------------------- */

/**
 * Parses multiline string of ranges (e.g. "1-15: Random Encounter") into structured objects.
 */
export function parseComplicationTable(text) {
    if (!text || typeof text !== "string") return [];
    const lines = text.split(/[;\r\n]+/).map(l => l.trim()).filter(Boolean);
    const entries = [];
    for (const line of lines) {
        const match = line.match(/^(\d+)(?:\s*(?:-|\.\.)\s*(\d+))?\s*[:\-–]\s*(.+)$/);
        if (match) {
            const min = parseInt(match[1], 10);
            const max = match[2] ? parseInt(match[2], 10) : min;
            const description = match[3].trim();
            entries.push({ min: Math.min(min, max), max: Math.max(min, max), text: description });
        }
    }
    return entries;
}

/**
 * Finds matching complication outcome text from parsed entries.
 */
export function getComplicationOutcome(rollTotal, entries) {
    for (const entry of entries) {
        if (rollTotal >= entry.min && rollTotal <= entry.max) {
            return entry.text;
        }
    }
    return null;
}

/**
 * Rolls for complication consequence using d20 range table or configured RollTable.
 */
export async function rollComplication({ reason = "", userId = game.user.id } = {}) {
    if (!isRiskDiceEnabled()) {
        ui.notifications.warn("Risk Dice variant is currently disabled in module settings.");
        return;
    }

    if (!game.settings.get(MODULE_ID, "riskDiceComplicationTableEnabled")) {
        ui.notifications.warn("Complication roll table is currently disabled in module settings.");
        return;
    }

    if (!game.user.isGM) {
        const activeGM = getPrimaryActiveGM();
        if (!activeGM) {
            ui.notifications.warn("Risk Dice: An active Game Master must be online to roll complications.");
            return;
        }
        game.socket.emit(SOCKET_EVENT, {
            action: "rollComplication",
            userId: game.user.id,
            reason: reason
        });
        ui.notifications.info("Rolling Complication... request sent to Game Master.");
        return;
    }

    const triggeringUser = game.users.get(userId) || game.user;
    const speaker = ChatMessage.getSpeaker({ user: triggeringUser });
    const isPublic = Boolean(game.settings.get(MODULE_ID, "riskDiceComplicationPublic"));

    // Roll once using the configured formula for either table source.
    const formula = game.settings.get(MODULE_ID, "riskDiceComplicationFormula") || "1d20";
    const roll = new Roll(formula);
    await roll.evaluate();

    // Check if an existing Foundry RollTable is configured
    const tableNameOrUuid = game.settings.get(MODULE_ID, "riskDiceComplicationRollTable")?.trim();
    if (tableNameOrUuid) {
        const table = fromUuidSync(tableNameOrUuid) || game.tables.getName(tableNameOrUuid);
        if (table) {
            const rollMode = isPublic ? CONST.DICE_ROLL_MODES.PUBLIC : CONST.DICE_ROLL_MODES.BLIND;
            await table.draw({ roll, rollMode });
            return;
        }
    }

    // Roll formula and evaluate against ranges
    const tableText = game.settings.get(MODULE_ID, "riskDiceComplicationTableEntries") || "";
    const entries = parseComplicationTable(tableText);
    const outcome = getComplicationOutcome(roll.total, entries) || "Complication occurs (no matching range defined in settings).";

    const gmRecipients = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
    const reasonHtml = reason ? `<div class="risk-reason-box"><i class="fa-solid fa-quote-left"></i> ${reason}</div>` : "";

    const announceBtn = !isPublic ? `
        <button type="button" class="risk-announce-btn risk-announce-result-btn" data-action="announce-complication-result" data-roll="${roll.total}" data-text="${escapeHtml(outcome)}">
            <i class="fa-solid fa-bullhorn"></i> Announce Result to Players
        </button>
    ` : "";

    const content = `
        <div class="pf2e-risk-card ${isPublic ? 'public' : 'gm-secret'}" style="border-color: #b82d2d; background: linear-gradient(135deg, #2b1414 0%, #170d0d 100%);">
            <div class="risk-card-header">
                <i class="fa-solid fa-dice-d20 header-icon" style="color: #ff5252;"></i>
                <div class="header-titles">
                    <h3 style="color: #ff9191;">Complication Table Roll</h3>
                    <div class="subtitle">Formula: ${formula}</div>
                </div>
            </div>
            <div class="risk-card-body">
                ${reasonHtml}
                <div style="text-align: center; margin: 8px 0;">
                    <div class="risk-d20-display" title="Rolled ${roll.total}">
                        <i class="fa-solid fa-dice-d20" style="font-size: 0.55em; margin-bottom: -3px; color: #ff8585;"></i>
                        <span>${roll.total}</span>
                    </div>
                </div>
                <div class="risk-complication-outcome">
                    <h4><i class="fa-solid fa-triangle-exclamation"></i> Complication:</h4>
                    <div class="risk-complication-text">${outcome}</div>
                </div>
                ${announceBtn}
            </div>
        </div>
    `;

    await ChatMessage.create({
        speaker: speaker,
        content: content,
        flavor: `Complication Roll (${formula})`,
        rolls: [roll],
        whisper: isPublic ? [] : gmRecipients,
        blind: !isPublic
    });
}

/**
 * Publicly announces the complication outcome to chat.
 */
export async function announceComplicationResultToChat({ rollTotal = 0, text = "" } = {}) {
    if (!text) return;

    const rollInfo = rollTotal > 0 ? ` (Rolled ${rollTotal})` : "";
    const content = `
        <div class="pf2e-risk-card public" style="border-color: #b82d2d; background: linear-gradient(135deg, #2b1414 0%, #170d0d 100%);">
            <div class="risk-card-header">
                <i class="fa-solid fa-triangle-exclamation header-icon" style="color: #ff5252;"></i>
                <div class="header-titles">
                    <h3 style="color: #ff9191;">Complication In Effect!</h3>
                    <div class="subtitle">Risk Dice Consequence${rollInfo}</div>
                </div>
            </div>
            <div class="risk-card-body">
                <div class="risk-complication-outcome" style="margin-top: 5px;">
                    <div class="risk-complication-text" style="font-size: 1.1em; color: #fff;">
                        ${text}
                    </div>
                </div>
            </div>
        </div>
    `;

    await ChatMessage.create({
        speaker: { alias: "Risk Dice" },
        content: content
    });
}

/* ------------------------------------------------------------------------- */
/* 6. FLOATING HUD WIDGET                                                    */
/* ------------------------------------------------------------------------- */

let riskHudElement = null;

export function initRiskDiceHUD() {
    renderRiskDiceHUD();
}

export function renderRiskDiceHUD() {
    // Clean up existing HUD if present
    if (riskHudElement) {
        riskHudElement.remove();
        riskHudElement = null;
    }

    if (!isRiskDiceEnabled()) return;

    const showHudSetting = Boolean(game.settings.get(MODULE_ID, "riskDiceShowHud"));
    if (!showHudSetting) return;

    const canSeeCount = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeCount"));
    const count = getRiskDiceCount();
    const displayCount = (game.user.isGM || canSeeCount) ? count : "?";

    // Create container
    riskHudElement = document.createElement("div");
    riskHudElement.id = "pf2e-risk-dice-hud";
    riskHudElement.title = "PF2e Risk Dice (Drag to reposition)";

    // Restore saved position if available
    try {
        const savedPos = JSON.parse(localStorage.getItem("pf2e-risk-dice-hud-pos") || "null");
        if (savedPos && typeof savedPos.top === "number" && typeof savedPos.left === "number") {
            riskHudElement.style.top = `${savedPos.top}px`;
            riskHudElement.style.left = `${savedPos.left}px`;
            riskHudElement.style.right = "auto";
        }
    } catch {
        // Use default CSS positioning
    }

    const isGM = game.user.isGM;

    // Construct HUD inner HTML
    const gmButtonsHtml = isGM ? `
        <div class="risk-hud-actions">
            <button type="button" class="risk-hud-btn take-risk-btn" id="risk-hud-take-btn" title="Take a Risk (+1 & Secret Roll)">
                <i class="fa-solid fa-plus"></i>
            </button>
            <button type="button" class="risk-hud-btn" id="risk-hud-roll-btn" title="Roll Current Pool (${count}d6)">
                <i class="fa-solid fa-dice-d6"></i>
            </button>
            <button type="button" class="risk-hud-btn" id="risk-hud-reset-btn" title="Reset Pool to 0">
                <i class="fa-solid fa-rotate-right"></i>
            </button>
            <button type="button" class="risk-hud-btn" id="risk-hud-settings-btn" title="Open Risk Dice Manager">
                <i class="fa-solid fa-gear"></i>
            </button>
        </div>
    ` : `
        <div class="risk-hud-actions">
            <button type="button" class="risk-hud-btn take-risk-btn" id="risk-hud-take-btn" title="Take a Risk">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    `;

    riskHudElement.innerHTML = `
        <div class="risk-hud-drag-handle" id="risk-hud-handle">
            <i class="fa-solid fa-dice-d6 risk-hud-icon"></i>
            <span class="risk-hud-label">Risk:</span>
            <span class="risk-hud-badge" id="risk-hud-count-display">${displayCount}</span>
        </div>
        ${gmButtonsHtml}
    `;

    document.body.appendChild(riskHudElement);

    // Event listeners
    attachHudListeners(riskHudElement);
}

export function updateRiskDiceHUD(newCount) {
    if (!riskHudElement) {
        renderRiskDiceHUD();
        return;
    }
    const canSeeCount = Boolean(game.settings.get(MODULE_ID, "riskDicePlayerCanSeeCount"));
    const count = newCount !== undefined ? newCount : getRiskDiceCount();
    const displayCount = (game.user.isGM || canSeeCount) ? count : "?";
    const countDisplay = riskHudElement.querySelector("#risk-hud-count-display");
    if (countDisplay) {
        countDisplay.textContent = displayCount;
    }
    const rollBtn = riskHudElement.querySelector("#risk-hud-roll-btn");
    if (rollBtn) {
        const dieFaces = game.settings.get(MODULE_ID, "riskDiceDieFaces") || 6;
        rollBtn.title = `Roll Current Pool (${count}d${dieFaces})`;
    }
}

function attachHudListeners(hud) {
    // 1. Draggable logic
    const handle = hud.querySelector("#risk-hud-handle");
    if (handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = hud.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            e.preventDefault();

            const onMouseMove = (moveEvent) => {
                if (!isDragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                const newLeft = Math.max(10, Math.min(window.innerWidth - 150, initialLeft + dx));
                const newTop = Math.max(10, Math.min(window.innerHeight - 50, initialTop + dy));

                hud.style.left = `${newLeft}px`;
                hud.style.top = `${newTop}px`;
                hud.style.right = "auto";
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    const rect = hud.getBoundingClientRect();
                    try {
                        localStorage.setItem("pf2e-risk-dice-hud-pos", JSON.stringify({
                            left: Math.round(rect.left),
                            top: Math.round(rect.top)
                        }));
                    } catch {}
                }
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });
    }

    // 2. Action buttons
    hud.querySelector("#risk-hud-take-btn")?.addEventListener("click", () => {
        takeRisk();
    });

    hud.querySelector("#risk-hud-roll-btn")?.addEventListener("click", () => {
        if (!game.user.isGM) return;
        executeCurrentPoolRoll();
    });

    hud.querySelector("#risk-hud-reset-btn")?.addEventListener("click", async () => {
        if (!game.user.isGM) return;
        await resetRiskDice();
    });

    hud.querySelector("#risk-hud-settings-btn")?.addEventListener("click", () => {
        openRiskDiceDialog();
    });
}

/* ------------------------------------------------------------------------- */
/* 7. SCENE CONTROLS INTEGRATION                                             */
/* ------------------------------------------------------------------------- */

export function registerRiskDiceSceneControls(controls) {
    if (!isRiskDiceEnabled()) return;
    if (!game.user.isGM) return;

    // Support Array (v12 and earlier), Map/Collection, or Record/Object (v13/v14)
    let tokenControls = null;
    if (Array.isArray(controls)) {
        tokenControls = controls.find(c => c?.name === "token");
    } else if (controls instanceof Map || typeof controls?.get === "function") {
        tokenControls = controls.get("token");
    } else if (controls && typeof controls === "object") {
        tokenControls = controls.token || Object.values(controls).find(c => c?.name === "token");
    }
    const count = getRiskDiceCount();
    const showHud = Boolean(game.settings.get(MODULE_ID, "riskDiceShowHud"));
    const toolData = {
        name: "risk-dice-manager",
        title: `Risk Dice (Pool: ${count})`,
        icon: "fa-solid fa-dice-d6",
        visible: true,
        button: true,
        onClick: () => openRiskDiceDialog(),
        onChange: () => openRiskDiceDialog(),
        callback: () => openRiskDiceDialog()
    };
    const toggleHudToolData = {
        name: "risk-dice-toggle-hud",
        title: `${showHud ? "Hide" : "Show"} Risk Dice Toolbar`,
        icon: showHud ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
        visible: true,
        button: true,
        onClick: async () => {
            await game.settings.set(MODULE_ID, "riskDiceShowHud", !Boolean(game.settings.get(MODULE_ID, "riskDiceShowHud")));
        }
    };
    const riskDiceControls = {
        name: "risk-dice",
        title: "Risk Dice",
        icon: "fa-solid fa-dice-d6",
        layer: "TokenLayer",
        tools: {
            [toggleHudToolData.name]: toggleHudToolData
        }
    };

    if (Array.isArray(controls)) {
        const existingIdx = controls.findIndex(control => control?.name === "risk-dice");
        if (existingIdx >= 0) {
            controls[existingIdx] = riskDiceControls;
        } else {
            controls.push(riskDiceControls);
        }
    } else if (controls instanceof Map || typeof controls?.set === "function") {
        controls.set("risk-dice", riskDiceControls);
    } else if (controls && typeof controls === "object") {
        controls["risk-dice"] = riskDiceControls;
    }

    if (!tokenControls) return;

    if (Array.isArray(tokenControls.tools)) {
        const existingIdx = tokenControls.tools.findIndex(t => t?.name === toolData.name);
        if (existingIdx >= 0) {
            tokenControls.tools[existingIdx] = toolData;
        } else {
            tokenControls.tools.push(toolData);
        }
    } else if (tokenControls.tools instanceof Map || typeof tokenControls.tools?.set === "function") {
        tokenControls.tools.set("risk-dice-manager", toolData);
    } else if (tokenControls.tools && typeof tokenControls.tools === "object") {
        tokenControls.tools["risk-dice-manager"] = toolData;
    }
}

/* ------------------------------------------------------------------------- */
/* 8. RISK DICE MANAGER DIALOG                                               */
/* ------------------------------------------------------------------------- */

let activeManagerDialog = null;

function updateOpenManagerDialog(count) {
    if (activeManagerDialog && activeManagerDialog.element && activeManagerDialog.element.length) {
        const counterEl = activeManagerDialog.element.find("#risk-dialog-count");
        if (counterEl.length) counterEl.text(count);
        const inputEl = activeManagerDialog.element.find("#risk-dialog-custom-input");
        if (inputEl.length) inputEl.val(count);
    }
}

export function openRiskDiceDialog() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the Game Master can open the Risk Dice Manager.");
        return;
    }

    const count = getRiskDiceCount();
    const dieFaces = game.settings.get(MODULE_ID, "riskDiceDieFaces") || 6;
    const targetNumber = game.settings.get(MODULE_ID, "riskDiceTargetNumber") || 1;

    const content = `
        <div class="risk-manager-dialog risk-dialog-container">
            <div class="risk-dialog-count-card">
                <div class="risk-dialog-count-label">Current Risk Dice Pool</div>
                <div class="risk-dialog-count-number" id="risk-dialog-count">${count}</div>
                <div style="font-size: 0.85em; color: #bba998;">Die: <strong>d${dieFaces}</strong> | Complication Face: <strong>${targetNumber}</strong></div>
            </div>

            <div class="risk-dialog-btn-grid">
                <button type="button" class="primary-action full-width" id="dialog-take-risk">
                    <i class="fa-solid fa-plus"></i> Take a Risk (+1 & Secret Roll)
                </button>
                <button type="button" class="primary-action full-width" id="dialog-roll-complication">
                    <i class="fa-solid fa-dice-d20"></i> Roll Complication Table (d20)
                </button>
                <button type="button" class="secondary-action" id="dialog-roll-pool">
                    <i class="fa-solid fa-dice-d6"></i> Roll Current Pool
                </button>
                <button type="button" class="secondary-action" id="dialog-reset-pool">
                    <i class="fa-solid fa-rotate-right"></i> Reset to 0
                </button>
                <button type="button" class="secondary-action" id="dialog-add-die">
                    <i class="fa-solid fa-arrow-up"></i> +1 Die (No Roll)
                </button>
                <button type="button" class="secondary-action" id="dialog-sub-die">
                    <i class="fa-solid fa-arrow-down"></i> -1 Die
                </button>
            </div>

            <div class="risk-dialog-set-group">
                <label for="risk-dialog-custom-input" style="font-weight: 600; font-size: 0.9em; flex: 1;">Set Pool Directly:</label>
                <input type="number" id="risk-dialog-custom-input" min="0" value="${count}" />
                <button type="button" id="dialog-set-count" style="padding: 2px 10px; height: 30px; cursor: pointer;">Set</button>
            </div>
        </div>
    `;

    activeManagerDialog = new Dialog({
        title: "Risk Dice Manager",
        content: content,
        buttons: {
            close: {
                icon: '<i class="fa-solid fa-check"></i>',
                label: "Done"
            }
        },
        default: "close",
        render: (html) => {
            html.find("#dialog-take-risk").click(async () => {
                await executeRiskRoll({ reason: "GM Risk Trigger" });
            });

            html.find("#dialog-roll-complication").click(async () => {
                await rollComplication({ reason: "Manual Complication Roll" });
            });

            html.find("#dialog-roll-pool").click(async () => {
                await executeCurrentPoolRoll();
            });

            html.find("#dialog-reset-pool").click(async () => {
                await resetRiskDice();
            });

            html.find("#dialog-add-die").click(async () => {
                await modifyRiskDiceCount(1);
            });

            html.find("#dialog-sub-die").click(async () => {
                await modifyRiskDiceCount(-1);
            });

            html.find("#dialog-set-count").click(async () => {
                const val = parseInt(html.find("#risk-dialog-custom-input").val(), 10) || 0;
                await setRiskDiceCount(val);
            });
        },
        close: () => {
            activeManagerDialog = null;
        }
    }, { width: 380 });

    activeManagerDialog.render(true);
}

/* ------------------------------------------------------------------------- */
/* 9. CHAT MESSAGE CLICK LISTENERS                                           */
/* ------------------------------------------------------------------------- */

export function registerRiskDiceChatListeners() {
    Hooks.on("renderChatMessage", (message, html) => {
        if (!game.user.isGM) return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        // Announce Complication Triggered
        const announceBtn = root.querySelector('.risk-announce-btn[data-action="announce-complication"]');
        if (announceBtn) {
            announceBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                const count = parseInt(announceBtn.dataset.count, 10) || 0;
                const reason = announceBtn.dataset.reason || "";
                await announceComplicationToChat({ count, reason });
            });
        }

        // Roll Complication Table
        const rollCompBtn = root.querySelector('.risk-roll-complication-btn[data-action="roll-complication"]');
        if (rollCompBtn) {
            rollCompBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                const reason = rollCompBtn.dataset.reason || "";
                await rollComplication({ reason });
            });
        }

        // Announce Specific Complication Result
        const announceResultBtn = root.querySelector('.risk-announce-result-btn[data-action="announce-complication-result"]');
        if (announceResultBtn) {
            announceResultBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                const rollTotal = parseInt(announceResultBtn.dataset.roll, 10) || 0;
                const text = announceResultBtn.dataset.text || "";
                await announceComplicationResultToChat({ rollTotal, text });
            });
        }
    });
}

/* ------------------------------------------------------------------------- */
/* 10. SETTINGS CONFIG UI ENHANCEMENT                                        */
/* ------------------------------------------------------------------------- */

Hooks.on("renderSettingsConfig", (app, html) => {
    const root = html instanceof HTMLElement ? html : (html[0] || document);
    const input = root.querySelector?.(`input[name="${MODULE_ID}.riskDiceComplicationTableEntries"]`);
    if (input) {
        const textarea = document.createElement("textarea");
        textarea.name = input.name;
        textarea.value = input.value;
        textarea.rows = 5;
        textarea.style.fontFamily = "var(--font-mono, monospace)";
        textarea.style.resize = "vertical";
        textarea.style.width = "100%";
        textarea.placeholder = "1-10: Wandering Monsters\n11-15: Environmental Hazard\n16-20: Injury";
        input.replaceWith(textarea);
    }
});
