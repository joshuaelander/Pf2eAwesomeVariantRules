/**
 * PF2e Awesome Improved Learn a Spell (House Rule: The Quick Study)
 * For Foundry VTT v14 / PF2e System
 * 
 * Replaces standard Learn a Spell with reduced time/cost rules.
 */

export const QUICK_STUDY_MACRO_NAME = "Quick Study (Learn a Spell)";
export const QUICK_STUDY_MACRO_ICON = "systems/pf2e/icons/spells/read-aura.webp";

// Define the cost and time scaling based on spell rank
const SPELL_RANK_DATA = {
    1: { time: 1, cost: 2, levelDC: 15 },
    2: { time: 1, cost: 5, levelDC: 16 },
    3: { time: 1, cost: 12.5, levelDC: 18 },
    4: { time: 1, cost: 25, levelDC: 19 },
    5: { time: 1, cost: 50, levelDC: 20 },
    6: { time: 2, cost: 100, levelDC: 22 },
    7: { time: 2, cost: 225, levelDC: 23 },
    8: { time: 2, cost: 500, levelDC: 24 },
    9: { time: 2, cost: 1200, levelDC: 26 },
    10: { time: 2, cost: 3500, levelDC: 27 }
};

// Available skills for learning spells
const SKILLS = [
    { key: 'arcana', label: 'Arcana' },
    { key: 'nature', label: 'Nature' },
    { key: 'occultism', label: 'Occultism' },
    { key: 'religion', label: 'Religion' }
];

/**
 * Main execution function for the Quick Study macro.
 */
export async function executeQuickStudy() {
    const actor = canvas.tokens.controlled[0]?.actor ?? game.user?.character;

    if (!actor) {
        ui.notifications.warn("Quick Study: Please select a token or assign a character to your user.");
        return;
    }

    // Construct the dialog content
    let rankOptions = "";
    for (let rank = 1; rank <= 10; rank++) {
        const data = SPELL_RANK_DATA[rank];
        rankOptions += `<option value="${rank}">Rank ${rank} (Base Cost: ${data.cost} gp, Time: ${data.time} Hour${data.time > 1 ? 's' : ''})</option>`;
    }

    let skillOptions = "";
    for (const skill of SKILLS) {
        // Get the actor's modifier for display
        const skillObj = actor.skills?.[skill.key];
        const modifier = skillObj?.mod ?? 0;
        const modString = modifier >= 0 ? `+${modifier}` : modifier;
        skillOptions += `<option value="${skill.key}">${skill.label} (${modString})</option>`;
    }

    const content = `
    <form>
        <div class="form-group">
            <label>Spell Rank:</label>
            <select id="spell-rank" name="spell-rank">
                ${rankOptions}
            </select>
        </div>
        <div class="form-group">
            <label>Skill to Use:</label>
            <select id="skill-choice" name="skill-choice">
                ${skillOptions}
            </select>
        </div>
    </form>
    <p><em>Note: You need 1-2 hours of undistracted study and access to the spell (scroll, teacher, etc.).</em></p>
    `;

    // Create the dialog
    new Dialog({
        title: `Learn a Spell (Quick Study): ${actor.name}`,
        content: content,
        buttons: {
            roll: {
                icon: '<i class="fas fa-dice-d20"></i>',
                label: "Roll Check",
                callback: (html) => {
                    const rank = parseInt(html.find('#spell-rank')[0].value);
                    const skillKey = html.find('#skill-choice')[0].value;
                    performQuickStudy(actor, rank, skillKey);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "roll"
    }).render(true);
}

/**
 * Executes the Quick Study logic
 * @param {ActorPF2e} actor The actor performing the action
 * @param {Number} rank The rank of the spell
 * @param {String} skillKey The key of the skill being used
 */
async function performQuickStudy(actor, rank, skillKey) {
    const data = SPELL_RANK_DATA[rank];
    const skill = actor.skills?.[skillKey];

    if (!skill) {
        ui.notifications.error(`Quick Study: Skill ${skillKey} not found on actor.`);
        return;
    }

    // PF2e System expected DC object format
    const dc = {
        value: data.levelDC,
        visibility: "all"
    };

    // Create the roll
    const roll = await new Roll(`1d20 + ${skill.mod}`).evaluate();

    // Determine Degree of Success
    let total = roll.total;
    let degree = 0; // 0: CF, 1: F, 2: S, 3: CS

    if (total >= dc.value + 10) degree = 3;
    else if (total >= dc.value) degree = 2;
    else if (total <= dc.value - 10) degree = 0;
    else degree = 1;

    // Adjust for natural 1 and natural 20
    const dieValue = roll.dice[0].results[0].result;
    if (dieValue === 20) {
        degree = Math.min(3, degree + 1);
    } else if (dieValue === 1) {
        degree = Math.max(0, degree - 1);
    }

    // Determine outcomes based on house rules
    let outcomeText = "";
    let costText = "";
    let cssClass = "";
    let finalCost = 0;

    switch (degree) {
        case 3: // Critical Success
            outcomeText = "Critical Success";
            cssClass = "critical-success";
            finalCost = data.cost / 2;
            costText = `You grasp the spell instantly with minimal waste. Pay <b>${finalCost} gp</b> (Half Base Cost).`;
            break;
        case 2: // Success
            outcomeText = "Success";
            cssClass = "success";
            finalCost = data.cost;
            costText = `You learn the spell. Pay <b>${finalCost} gp</b> (Base Cost).`;
            break;
        case 1: // Failure
            outcomeText = "Failure";
            cssClass = "failure";
            finalCost = 0;
            costText = `You fail to learn the spell, but realize your mistake early. <b>No cost paid.</b> You can try again after gaining a level.`;
            break;
        case 0: // Critical Failure
            outcomeText = "Critical Failure";
            cssClass = "critical-failure";
            finalCost = data.cost / 2;
            costText = `You waste materials in a volatile reaction. Pay <b>${finalCost} gp</b> (Half Base Cost), and you cannot try again until you gain a level.`;
            break;
    }

    // Construct Chat Message
    const skillName = skillKey.charAt(0).toUpperCase() + skillKey.slice(1);

    let chatContent = `
    <div class="pf2e chat-card">
        <header class="card-header flexrow">
            <img src="systems/pf2e/icons/spells/read-aura.webp" title="Learn a Spell" width="36" height="36"/>
            <h3>Learn a Spell: Quick Study</h3>
        </header>
        <div class="card-content">
            <p><strong>Spell Rank:</strong> ${rank}</p>
            <p><strong>Time Required:</strong> ${data.time} Hour${data.time > 1 ? 's' : ''}</p>
            <p><strong>Skill:</strong> ${skillName}</p>
        </div>
        <hr>
        <div class="dice-roll">
            <div class="dice-result">
                <div class="dice-formula">${roll.formula}</div>
                <div class="dice-tooltip" style="display: none;">
                    <section class="tooltip-part">
                        <div class="dice">
                            <header class="part-header flexrow">
                                <span class="part-formula">${roll.formula}</span>
                            </header>
                            <ol class="dice-rolls">
                                <li class="roll die d20">${dieValue}</li>
                            </ol>
                        </div>
                    </section>
                </div>
                <h4 class="dice-total">${total} vs DC ${dc.value}</h4>
            </div>
        </div>
        <div class="message-content">
            <div class="pf2e-result-text ${cssClass}" style="padding: 5px; text-align: center; font-weight: bold; margin-top: 5px; border-radius: 3px;">
                ${outcomeText}
            </div>
            <p style="margin-top: 5px;">${costText}</p>
        </div>
    </div>
    `;

    // Send to chat
    ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        content: chatContent,
        rolls: [roll]
    });
}