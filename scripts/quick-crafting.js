// PF2e Awesome Improved Crafting: Quick Crafting House Rule Macro for Pathfinder 2e (Foundry VTT v14+)

export const QUICK_CRAFTING_MACRO_NAME = "Quick Crafting";
export const QUICK_CRAFTING_MACRO_ICON = "icons/tools/smithing/anvil.webp";

/**
 * Main execution function for the Quick Crafting macro.
 */
export async function executeQuickCrafting() {
    const actor = canvas.tokens.controlled[0]?.actor ?? game.user?.character;

    if (!actor) {
        ui.notifications.warn("Quick Crafting: Please select a token or assign a character to your user.");
        return;
    }

    const craftingSkill = actor.skills?.crafting;
    if (!craftingSkill) {
        ui.notifications.warn("Quick Crafting: Could not find Crafting skill on the selected actor.");
        return;
    }

    const rank = craftingSkill.rank ?? 0; // 0: Untrained, 1: Trained, 2: Expert, 3: Master, 4: Legendary
    const rankNames = ["Untrained", "Trained", "Expert", "Master", "Legendary"];

    if (rank < 1) {
        ui.notifications.warn("Quick Crafting: You must be at least Trained in Crafting to use this macro.");
        return;
    }

    // PF2e standard Earn Income by character level and proficiency rank
    // Format: level: [Untrained, Trained, Expert, Master, Legendary]
    const earnIncomeMap = {
        0: [0, 0.05, 0.05, 0.05, 0.05],
        1: [0, 0.2, 0.2, 0.2, 0.2],
        2: [0, 0.3, 0.3, 0.3, 0.3],
        3: [0, 0.5, 0.5, 0.5, 0.5],
        4: [0, 0.7, 0.8, 0.8, 0.8],
        5: [0, 0.9, 1, 1, 1],
        6: [0, 1.5, 2, 2, 2],
        7: [0, 2, 2.5, 2.5, 2.5],
        8: [0, 2.5, 3, 3, 3],
        9: [0, 3, 4, 4, 4],
        10: [0, 4, 5, 6, 6],
        11: [0, 5, 6, 8, 8],
        12: [0, 6, 8, 10, 10],
        13: [0, 7, 10, 15, 15],
        14: [0, 8, 15, 20, 20],
        15: [0, 10, 20, 28, 28],
        16: [0, 13, 25, 36, 40],
        17: [0, 15, 30, 45, 55],
        18: [0, 20, 45, 70, 90],
        19: [0, 30, 60, 100, 130],
        20: [0, 40, 75, 150, 200]
    };

    const dialogContent = `
    <style>
        .qc-form { font-family: "Signika", sans-serif; padding: 5px; }
        .qc-form .form-group { margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
        .qc-form .form-group label { font-weight: bold; flex: 1; }
        .qc-form .form-group input[type="text"],
        .qc-form .form-group input[type="number"] { flex: 1; padding: 4px; border: 1px solid #7a7971; border-radius: 3px; background: rgba(0, 0, 0, 0.05); }
        .qc-form .form-group input[type="checkbox"] { flex: 1; height: 20px; }
        .qc-form hr { margin: 15px 0; border: 0; border-top: 1px solid #c9c7b8; }
        .qc-notes { font-size: 0.85em; color: #4b4a44; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 5px; }
    </style>
    <div class="qc-form">
        <p>Configure your crafting project for <strong>${actor.name}</strong> (${rankNames[rank]}):</p>
        <div class="form-group">
            <label>Item Name:</label>
            <input type="text" id="itemName" name="itemName" placeholder="e.g., Striking Rune" required />
        </div>
        <div class="form-group">
            <label>Item Level:</label>
            <input type="number" id="itemLevel" name="itemLevel" min="0" max="20" value="1" required />
        </div>
        <div class="form-group">
            <label>Base Price (gp):</label>
            <input type="number" id="itemPrice" name="itemPrice" min="0" step="0.01" value="1.00" required />
        </div>
        <hr>
        <div class="form-group">
            <label>Is Consumable?</label>
            <input type="checkbox" id="isConsumable" name="isConsumable" />
        </div>
        <div class="form-group">
            <label>Have Formula?</label>
            <input type="checkbox" id="hasFormula" name="hasFormula" checked />
        </div>
        <div class="form-group">
            <label>Additional Days Worked:</label>
            <input type="number" id="daysWorked" name="daysWorked" min="0" max="7" value="1" />
        </div>
        <div class="qc-notes">
            <em>Note: You need Magical/Alchemical Crafting feats as appropriate. Consumables/ammunition can be crafted in batches.</em>
        </div>
    </div>
    `;

    const inputData = await new Promise((resolve) => {
        new Dialog({
            title: `⚒️ Quick Crafting: ${actor.name}`,
            content: dialogContent,
            buttons: {
                craft: {
                    icon: '<i class="fas fa-hammer"></i>',
                    label: "Roll Crafting",
                    callback: (html) => {
                        resolve({
                            name: html.find('#itemName').val(),
                            level: parseInt(html.find('#itemLevel').val()) || 0,
                            price: parseFloat(html.find('#itemPrice').val()) || 0,
                            isConsumable: html.find('#isConsumable').is(':checked'),
                            hasFormula: html.find('#hasFormula').is(':checked'),
                            daysWorked: parseInt(html.find('#daysWorked').val()) || 0
                        });
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            default: "craft"
        }, { width: 400 }).render(true);
    });

    if (!inputData) return; // User cancelled

    // Rule: Cannot craft items above your level
    if (inputData.level > actor.level) {
        ui.notifications.error(`Quick Crafting: ${actor.name} is level ${actor.level} and cannot craft a level ${inputData.level} item.`);
        return;
    }

    // Rule: 9th level+ requires master, 17th level+ requires legendary
    if (inputData.level >= 9 && rank < 3) {
        ui.notifications.error("Quick Crafting: Crafting an item of level 9 or higher requires Master proficiency.");
        return;
    }
    if (inputData.level >= 17 && rank < 4) {
        ui.notifications.error("Quick Crafting: Crafting an item of level 17 or higher requires Legendary proficiency.");
        return;
    }

    // Rule: Max 7 days of work
    if (inputData.daysWorked > 7) {
        ui.notifications.warn("Quick Crafting: You can only work for a maximum of 7 additional days.");
        inputData.daysWorked = 7;
    }

    // 1. Setup Phase
    let setupDays = inputData.isConsumable ? 0.5 : 1;
    if (!inputData.hasFormula) setupDays *= 2;
    const setupCost = inputData.price * 0.5;

    // 2. Work Phase Data
    const cappedLevel = Math.min(actor.level, 20);
    const standardIncome = earnIncomeMap[cappedLevel][rank];
    const multiplierMap = [0, 1.5, 2.0, 2.5, 3.0];
    const multiplier = multiplierMap[rank];
    const dailySavingsRate = standardIncome * multiplier;

    // 3. Completion Roll (DC 14 + item's level)
    const craftMod = craftingSkill.mod; // PF2e natively includes INT, Proficiency, and Item Bonuses
    const dc = 14 + inputData.level;

    const roll = await new Roll(`1d20 + ${craftMod}`).evaluate();
    const d20 = roll.terms[0].results[0].result;
    const total = roll.total;

    // Determine Degree of Success (PF2e Rules)
    let dos = 0; // 1: Crit Fail, 2: Fail, 3: Success, 4: Crit Success
    if (total >= dc + 10) dos = 4;
    else if (total >= dc) dos = 3;
    else if (total <= dc - 10) dos = 1;
    else dos = 2;

    // Natural 1 and 20 adjustments
    if (d20 === 20) dos = Math.min(dos + 1, 4);
    if (d20 === 1) dos = Math.max(dos - 1, 1);

    let finalSavings = 0;
    let penaltyText = "";
    let extraCost = 0;
    let dosText = "";
    let dosColor = "";

    if (dos >= 3) {
        // Critical Success / Success
        finalSavings = inputData.daysWorked * dailySavingsRate;
        dosText = dos === 4 ? "Critical Success" : "Success";
        dosColor = dos === 4 ? "#008000" : "#0000ff"; // Green or Blue
    } else if (dos === 2) {
        // Failure
        finalSavings = inputData.daysWorked * (standardIncome * 1.0); // Reduced to 1.0x Earn Income
        dosText = "Failure";
        dosColor = "#ff8000"; // Orange
        penaltyText = "<br><em>Flaw found! Savings reduced to 1.0x standard Earn Income.</em>";
    } else {
        // Critical Failure
        finalSavings = 0;
        extraCost = inputData.price * 0.10; // Extra 10% for local assistance
        dosText = "Critical Failure";
        dosColor = "#ff0000"; // Red
        penaltyText = `<br><em>Disaster! Savings lost. You must pay an extra 10% (${extraCost.toFixed(2)} gp) for assistance or accept a moderate flaw.</em>`;
    }

    // Calculate final balance and boundaries
    let remainingCost = inputData.price - setupCost;
    let balanceToPay = Math.max(remainingCost - finalSavings, 0) + extraCost;
    let totalPaid = setupCost + balanceToPay;
    let actualSavings = inputData.price - totalPaid;
    if (actualSavings < 0) actualSavings = 0; // If you critted fail, you "saved" negative

    const totalDays = setupDays + inputData.daysWorked;

    const chatMessageContent = `
    <div class="pf2e chat-card">
        <header class="card-header flexrow" style="padding-bottom: 5px; border-bottom: 2px solid #5e0000; margin-bottom: 8px;">
            <h3 style="margin: 0; font-family: 'Palatino Linotype', serif; font-weight: bold;">Quick Crafting: ${inputData.name}</h3>
        </header>

        <div class="card-content" style="font-size: 13px; line-height: 1.4;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span><strong>Item Level:</strong> ${inputData.level}</span>
                <span><strong>DC:</strong> ${dc}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span><strong>Base Price:</strong> ${inputData.price.toFixed(2)} gp</span>
                <span><strong>Total Time:</strong> ${totalDays} Day(s)</span>
            </div>
            
            <div style="background: rgba(0,0,0,0.05); border: 1px solid #ccc; padding: 6px; border-radius: 4px; margin-bottom: 10px; text-align: center;">
                <div style="font-weight: bold; font-size: 15px; color: ${dosColor}; text-transform: uppercase;">${dosText}</div>
                ${penaltyText}
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px; border: 1px solid #ccc;">
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 4px;">Setup Cost (50%)</td>
                    <td style="padding: 4px; text-align: right;">${setupCost.toFixed(2)} gp</td>
                </tr>
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 4px;">Earn Income Base</td>
                    <td style="padding: 4px; text-align: right;">${standardIncome} gp/day</td>
                </tr>
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 4px;">Work Savings</td>
                    <td style="padding: 4px; text-align: right; color: #008000;">- ${finalSavings.toFixed(2)} gp</td>
                </tr>
                <tr style="background: rgba(0,0,0,0.05); font-weight: bold;">
                    <td style="padding: 4px;">Final Payment Due</td>
                    <td style="padding: 4px; text-align: right;">${balanceToPay.toFixed(2)} gp</td>
                </tr>
            </table>

            <div style="text-align: right; font-size: 14px; border-top: 2px solid #5e0000; padding-top: 5px;">
                <strong>Total Cost: ${totalPaid.toFixed(2)} gp</strong>
            </div>
        </div>
    </div>
    `;

    // Output to Chat
    ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        flavor: `<strong>Crafting Check</strong> (Quick Crafting)`,
        content: chatMessageContent,
        rolls: [roll] // This attaches the 3D dice and standard roll breakdown
    });
}