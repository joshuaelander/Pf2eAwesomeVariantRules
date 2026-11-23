/**
 * PF2e Awesome Variant Rules: Settings Section Headers
 *
 * Injects clean visual section headers into Foundry VTT's Configure Settings window
 * (similar to PF2e Toolbelt) so each variant rule's options are clearly grouped and easy to scan.
 */

const MODULE_ID = "pf2e-awesome-variant-rules";

/**
 * Ordered section definitions for the module's settings panel.
 * Each section header is inserted immediately before the first visible setting
 * in its `keys` list, so non-GM players never see empty headers for GM-only sections.
 */
const SETTINGS_SECTIONS = [
    {
        id: "macros-utilities",
        title: "Macros & Utilities",
        keys: ["syncMacrosMenu"]
    },
    {
        id: "split-dice",
        title: "Split Dice Variant",
        keys: ["splitSpellDamageEnabled", "splitHealingEnabled"]
    },
    {
        id: "risk-dice",
        title: "Risk Dice (Tension Dice)",
        keys: [
            "riskDiceEnabled",
            "riskDiceDieFaces",
            "riskDiceTargetNumber",
            "riskDiceResetOnComplication",
            "riskDicePublicAnnouncement",
            "riskDiceShowHud",
            "riskDicePlayerCanSeeRoll",
            "riskDicePlayerCanSeeCount"
        ]
    },
    {
        id: "risk-dice-complications",
        title: "Risk Dice — Complication Table",
        isSubheader: true,
        keys: [
            "riskDiceComplicationTableEnabled",
            "riskDiceComplicationFormula",
            "riskDiceComplicationTableEntries",
            "riskDiceComplicationRollTable",
            "riskDiceComplicationPublic"
        ]
    },
    {
        id: "spell-damage-modifier",
        title: "Spellcasting Damage Modifier",
        keys: [
            "spellDamageModifierVariantEnabled",
            "spellDamageModifierIncludeImpulses",
            "spellDamageModifierRestrictToClass"
        ]
    },
    {
        id: "dual-class",
        title: "Dual Class Variant",
        keys: [
            "dualClassEnabled",
            "dualClassAutoGrantFeatures",
            "dualClassAllowSharedKeyAlternative"
        ]
    },
    {
        id: "ancestry-paragon",
        title: "Ancestry Paragon Variant",
        keys: ["ancestryParagonEnabled"]
    },
    {
        id: "compendium-browser",
        title: "Compendium Browser Enhancements",
        keys: ["featBrowserSortLevelDesc", "smartArchetypeBrowseEnabled"]
    }
];

/**
 * Locate the `.form-group` DOM element for a registered setting or settings menu key.
 * Compatible with Foundry v12, v13, and v14 (ApplicationV2 SettingsConfig).
 *
 * @param {HTMLElement} root
 * @param {string} key
 * @returns {HTMLElement|null}
 */
function findSettingFormGroup(root, key) {
    const fullKey = `${MODULE_ID}.${key}`;
    const el = root.querySelector(
        `[name="${fullKey}"], [data-setting-id="${fullKey}"], button[data-key="${fullKey}"], [data-key="${fullKey}"]`
    );
    if (!el) return null;
    return el.closest(".form-group") || el;
}

/**
 * Register the `renderSettingsConfig` hook to inject section headers into Module Settings.
 */
export function registerSettingsHeaders() {
    Hooks.on("renderSettingsConfig", (_app, html) => {
        const root = html instanceof HTMLElement ? html : (html?.[0] ?? null);
        if (!root || !root.querySelector) return;

        // Scope to our module's category section if present, otherwise search root
        const moduleContainer = root.querySelector(
            `section[data-category="${MODULE_ID}"], .tab[data-tab="${MODULE_ID}"], [data-category="${MODULE_ID}"]`
        ) || root;

        let isFirstInserted = true;

        for (const section of SETTINGS_SECTIONS) {
            const headerId = `pf2e-avr-settings-header-${section.id}`;
            if (moduleContainer.querySelector(`#${headerId}`)) {
                isFirstInserted = false;
                continue;
            }

            // Find the first visible setting belonging to this section
            let firstGroup = null;
            for (const key of section.keys) {
                const group = findSettingFormGroup(moduleContainer, key);
                if (group) {
                    firstGroup = group;
                    break;
                }
            }
            if (!firstGroup) continue;

            const header = document.createElement("div");
            header.id = headerId;
            header.className = [
                "pf2e-avr-settings-header",
                section.isSubheader ? "is-subheader" : "",
                isFirstInserted ? "is-first" : ""
            ].filter(Boolean).join(" ");
            header.dataset.pf2eAvrSection = section.id;

            header.innerHTML = `
                <h3 class="pf2e-avr-settings-header-title">${foundry.utils.escapeHTML(section.title)}</h3>
            `;

            firstGroup.insertAdjacentElement("beforebegin", header);
            isFirstInserted = false;
        }
    });
}
