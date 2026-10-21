/**
 * PF2e Awesome Variant Rules (Main Entry Script)
 * This script runs once on the Foundry VTT 'ready' hook.
 * It serves as the module's entry point, handling imports, global registration, 
 * and programmatically syncing macro documents for user convenience.
 */

// --- 1. CONFIGURATION AND IMPORT MACRO LOGIC FILES ---
const MODULE_ID = "pf2e-awesome-variant-rules";
const MACRO_FOLDER_NAME = "PF2e Awesome Variant Rules";
const MACRO_FOLDER_COLOR = "#b136b1ff"; // Pink color for the macro folder

// Import the core functions and constants for the macros
import { executeQuickCrafting, QUICK_CRAFTING_MACRO_NAME, QUICK_CRAFTING_MACRO_ICON } from './quick-crafting.js';
import { executeQuickStudy, QUICK_STUDY_MACRO_NAME, QUICK_STUDY_MACRO_ICON } from './quick-study.js';
import { registerSplitDamageCardButtons, convertSpellDiceFormula } from './split-spell-damage.js';
import { registerSplitHealingCardButtons, convertHealingDiceFormula, rollSplitHealingFormula, triggerNativeInlineDamageRoll, promptSplitHealingDialog } from './split-healing.js';
import { convertDiceFormula } from './dice-utils.js';
import {
    registerSpellDamageSettings,
    initSpellDamageModifier,
    getActorSpellDamageConfig,
    calculateHalfModifier
} from './spell-damage-modifier.js';
import {
    registerRiskDiceSettings,
    registerRiskDiceSockets,
    registerRiskDiceChatListeners,
    registerRiskDiceSceneControls,
    initRiskDiceHUD,
    takeRisk,
    openRiskDiceDialog,
    toggleRiskDiceDialog,
    closeRiskDiceDialog,
    isManagerDialogOpen,
    getRiskDiceCount,
    setRiskDiceCount,
    resetRiskDice,
    modifyRiskDiceCount,
    executeCurrentPoolRoll,
    TAKE_RISK_MACRO_NAME,
    TAKE_RISK_MACRO_ICON,
    RISK_MANAGER_MACRO_NAME,
    RISK_MANAGER_MACRO_ICON,
    ROLL_COMPLICATION_MACRO_NAME,
    ROLL_COMPLICATION_MACRO_ICON,
    rollComplication,
    toggleRiskDiceHUD,
    hideRiskDiceHUD,
    showRiskDiceHUD,
    renderRiskDiceHUD,
    updateRiskDiceHUD
} from './risk-dice.js';

// --- 2. THE DESIRED MACRO STATE ---
// Add any new macros to this array. The Smart Sync will handle the rest!
const DESIRED_MACROS = [
    { name: QUICK_CRAFTING_MACRO_NAME, icon: QUICK_CRAFTING_MACRO_ICON, command: `game.pf2eAwesomeVariantRules.executeQuickCrafting();` },
    { name: QUICK_STUDY_MACRO_NAME, icon: QUICK_STUDY_MACRO_ICON, command: `game.pf2eAwesomeVariantRules.executeQuickStudy();` },
    { name: TAKE_RISK_MACRO_NAME, icon: TAKE_RISK_MACRO_ICON, command: `game.pf2eAwesomeVariantRules.takeRisk();` },
    { name: RISK_MANAGER_MACRO_NAME, icon: RISK_MANAGER_MACRO_ICON, command: `game.pf2eAwesomeVariantRules.openRiskDiceDialog();` },
    { name: ROLL_COMPLICATION_MACRO_NAME, icon: ROLL_COMPLICATION_MACRO_ICON, command: `game.pf2eAwesomeVariantRules.rollComplication();` }
];


// --- 3. HELPER FUNCTIONS ---

async function getOrCreateFolder(name, type) {
    let folder = game.folders.getName(name);

    if (!folder) {
        try {
            folder = await Folder.create({
                name: name,
                type: type,
                parent: null,
                color: MACRO_FOLDER_COLOR
            });
        } catch (err) {
            console.error(`PF2e Awesome Variant Rules | Failed to create folder: ${name}`, err);
            return null;
        }
    }
    return folder;
}

/**
 * Compares the existing macros in the world to the DESIRED_MACROS list.
 * Creates missing macros, updates existing ones, and deletes obsolete ones.
 */
async function syncMacros() {
    const folder = await getOrCreateFolder(MACRO_FOLDER_NAME, 'Macro');
    if (!folder) return;

    // Find all macros currently in the world that belong to this module
    const existingMacros = game.macros.filter(m => m.flags?.[MODULE_ID]?.isModuleMacro);
    const desiredNames = DESIRED_MACROS.map(m => m.name);
    const observerOwnership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };

    // 1. Delete Obsolete Macros (Exists in world, but no longer in DESIRED_MACROS)
    const obsoleteIds = existingMacros.filter(m => !desiredNames.includes(m.name)).map(m => m.id);
    if (obsoleteIds.length > 0) {
        await Macro.deleteDocuments(obsoleteIds);
        console.log(`PF2e Awesome Variant Rules | Deleted ${obsoleteIds.length} obsolete macros.`);
    }

    // 2. Create or Update Macros
    let createdCount = 0;
    let updatedCount = 0;

    for (const desired of DESIRED_MACROS) {
        const existing = existingMacros.find(m => m.name === desired.name);

        if (existing) {
            // If it exists, ensure the code, icon, folder, and ownership permissions are up to date
            if (existing.command !== desired.command ||
                existing.img !== desired.icon ||
                existing.folder?.id !== folder.id ||
                existing.ownership?.default !== observerOwnership.default) {

                await existing.update({
                    command: desired.command,
                    img: desired.icon,
                    folder: folder.id,
                    ownership: observerOwnership
                });
                updatedCount++;
            }
        } else {
            // If it doesn't exist, create it from scratch
            const macroData = {
                name: desired.name,
                type: "script",
                img: desired.icon,
                command: desired.command,
                folder: folder.id,
                ownership: observerOwnership,
                flags: { [MODULE_ID]: { isModuleMacro: true } }
            };
            await Macro.create(macroData, { renderSheet: false });
            createdCount++;
        }
    }

    if (createdCount > 0 || updatedCount > 0) {
        ui.notifications.info(`[PF2e Awesome Variant Rules] Sync complete! Created: ${createdCount}, Updated: ${updatedCount}.`);
    }
}


// --- 4. HOOKS AND INITIALIZATION ---
Hooks.once('init', () => {
    // Register Module Settings
    game.settings.register(MODULE_ID, "splitSpellDamageEnabled", {
        name: "Enable Split Spell Damage Dice",
        hint: "Adds an alternative 'Split Dice Damage' button on spell cards to replace damage dice with twice as many dice of half the size (minimum d4).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "splitHealingEnabled", {
        name: "Enable Split Healing & Recovery Dice",
        hint: "Adds an alternative 'Split Dice Healing' button on healing spells, impulses, and Treat Wounds to replace dice with twice as many half-sized dice (minimum d3).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Register Risk Dice (Tension Dice) Settings & Sockets
    registerRiskDiceSettings();
    registerRiskDiceSockets();

    // Register Spellcasting Damage Modifier Variant Settings
    registerSpellDamageSettings();
});

// Scene Controls Integration (Risk Dice GM tool)
Hooks.on('getSceneControlButtons', (controls) => {
    registerRiskDiceSceneControls(controls);
});

Hooks.once('ready', async () => {
    // Define a global namespace for module functions
    game.pf2eAwesomeVariantRules = game.pf2eAwesomeVariantRules || {};

    // Register Global Functions 
    game.pf2eAwesomeVariantRules.executeQuickCrafting = executeQuickCrafting;
    game.pf2eAwesomeVariantRules.quickCrafting = executeQuickCrafting;
    game.pf2eAwesomeVariantRules.executeQuickStudy = executeQuickStudy;
    game.pf2eAwesomeVariantRules.quickStudy = executeQuickStudy;
    game.pf2eAwesomeVariantRules.convertDiceFormula = convertDiceFormula;
    game.pf2eAwesomeVariantRules.convertSpellDiceFormula = convertSpellDiceFormula;
    game.pf2eAwesomeVariantRules.convertHealingDiceFormula = convertHealingDiceFormula;
    game.pf2eAwesomeVariantRules.rollSplitHealingFormula = rollSplitHealingFormula;
    game.pf2eAwesomeVariantRules.promptSplitHealingDialog = promptSplitHealingDialog;

    // Risk Dice Global API
    game.pf2eAwesomeVariantRules.takeRisk = takeRisk;
    game.pf2eAwesomeVariantRules.openRiskDiceDialog = openRiskDiceDialog;
    game.pf2eAwesomeVariantRules.toggleRiskDiceDialog = toggleRiskDiceDialog;
    game.pf2eAwesomeVariantRules.closeRiskDiceDialog = closeRiskDiceDialog;
    game.pf2eAwesomeVariantRules.isManagerDialogOpen = isManagerDialogOpen;
    game.pf2eAwesomeVariantRules.getRiskDiceCount = getRiskDiceCount;
    game.pf2eAwesomeVariantRules.setRiskDiceCount = setRiskDiceCount;
    game.pf2eAwesomeVariantRules.resetRiskDice = resetRiskDice;
    game.pf2eAwesomeVariantRules.modifyRiskDiceCount = modifyRiskDiceCount;
    game.pf2eAwesomeVariantRules.rollCurrentPool = executeCurrentPoolRoll;
    game.pf2eAwesomeVariantRules.rollComplication = rollComplication;
    game.pf2eAwesomeVariantRules.toggleRiskDiceHUD = toggleRiskDiceHUD;
    game.pf2eAwesomeVariantRules.hideRiskDiceHUD = hideRiskDiceHUD;
    game.pf2eAwesomeVariantRules.showRiskDiceHUD = showRiskDiceHUD;
    game.pf2eAwesomeVariantRules.renderRiskDiceHUD = renderRiskDiceHUD;
    game.pf2eAwesomeVariantRules.updateRiskDiceHUD = updateRiskDiceHUD;

    // Initialize Chat Card Buttons
    registerSplitDamageCardButtons();
    registerSplitHealingCardButtons();

    // Initialize Risk Dice Sockets, Listeners & Floating HUD
    registerRiskDiceSockets();
    registerRiskDiceChatListeners();
    initRiskDiceHUD();

    // Initialize Spellcasting Damage Modifier Variant
    initSpellDamageModifier();
    game.pf2eAwesomeVariantRules.getSpellDamageConfig = getActorSpellDamageConfig;
    game.pf2eAwesomeVariantRules.calculateHalfSpellDamageMod = calculateHalfModifier;

    if (game.user.isGM) {
        const currentVersion = game.modules.get(MODULE_ID)?.version || "1.0.0";
        let folder = game.folders.getName(MACRO_FOLDER_NAME);
        const storedVersion = folder ? folder.getFlag(MODULE_ID, "moduleVersion") : null;

        // Run the Smart Sync if the version has changed
        if (currentVersion !== storedVersion) {
            await syncMacros();

            // Re-fetch the folder just in case it was created during the sync
            folder = game.folders.getName(MACRO_FOLDER_NAME);
            if (folder) {
                await folder.setFlag(MODULE_ID, "moduleVersion", currentVersion);
            }
        }
    }
    console.log('PF2e Awesome Variant Rules | All module logic and macros initialized.');
});