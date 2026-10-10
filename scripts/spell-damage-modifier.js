/**
 * PF2e Awesome Variant Rules: Spellcasting Damage Modifier Variant
 * 
 * House Rule / Variant:
 * Adds an untyped bonus to spell damage (and Kineticist impulse damage) equal to
 * half of the character's primary spellcasting modifier (strict floor: Math.floor(mod / 2)).
 * 
 * Rules:
 * - Related to class only, excluding Free Archetype / archetype spells.
 * - Auto-detects class key attribute (e.g. Sorcerer = CHA, Bard = CHA, Wizard = INT, Kineticist = CON, Cleric = WIS).
 * - Full Dual-Class support with per-character sheet configuration (checkbox + stat dropdown).
 */

const MODULE_ID = "pf2e-awesome-variant-rules";

/**
 * Mapping of standard PF2e classes to their primary spellcasting/impulse attribute.
 */
export const CLASS_PRIMARY_ATTRIBUTES = {
    wizard: "int",
    witch: "int",
    magus: "int",
    sorcerer: "cha",
    bard: "cha",
    oracle: "cha",
    summoner: "cha",
    cleric: "wis",
    druid: "wis",
    animist: "wis",
    kineticist: "con",
    psychic: "int" // default fallback; psychic can also choose cha
};

/**
 * Register settings for the Spellcasting Damage Modifier variant.
 */
export function registerSpellDamageSettings() {
    game.settings.register(MODULE_ID, "spellDamageModifierVariantEnabled", {
        name: "Enable Spell Damage Modifier Variant",
        hint: "Adds an untyped bonus to spell damage (and kineticist impulse damage) equal to half of the character's primary spellcasting modifier (floor(mod / 2)).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            // Re-render open sheets and refresh actor synthetics
            for (const app of Object.values(ui.windows)) {
                if (app?.actor) app.render();
            }
        }
    });

    game.settings.register(MODULE_ID, "spellDamageModifierIncludeImpulses", {
        name: "Include Kineticist Impulses",
        hint: "Applies the half-modifier damage bonus (CON / 2) to Kineticist impulse damage rolls as well as spells.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "spellDamageModifierRestrictToClass", {
        name: "Restrict to Class Spells Only",
        hint: "When enabled, only spells from your primary class receive the bonus. Spells gained from Free Archetype or archetype dedications are excluded.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
}

/**
 * Calculate strict floor half modifier: floor(mod / 2) with minimum 0.
 * Examples: +1 mod -> +0; +2 or +3 mod -> +1; +4 or +5 mod -> +2; +6 mod -> +3.
 * 
 * @param {ActorPF2e} actor 
 * @param {string} abilityKey - 'int', 'wis', 'cha', 'con'
 * @returns {number}
 */
export function calculateHalfModifier(actor, abilityKey) {
    if (!actor?.system?.abilities?.[abilityKey]) return 0;
    const mod = Number(actor.system.abilities[abilityKey].mod ?? 0);
    return Math.max(0, Math.floor(mod / 2));
}

/**
 * Auto-detect the primary class attribute for a character actor.
 * 
 * @param {ActorPF2e} actor 
 * @returns {{ attribute: string, className: string, isSpellcasterOrKineticist: boolean }}
 */
export function autoDetectClassAttribute(actor) {
    if (!actor || actor.type !== "character") {
        return { attribute: "int", className: "", isSpellcasterOrKineticist: false };
    }

    const classItem = actor.class;
    const classSlug = (classItem?.slug || classItem?.name || "").toLowerCase().replace(/\s+/g, "-");
    const className = classItem?.name || "";

    // Check direct class mapping
    if (CLASS_PRIMARY_ATTRIBUTES[classSlug]) {
        let attr = CLASS_PRIMARY_ATTRIBUTES[classSlug];

        // Psychic special case: can be INT or CHA
        if (classSlug === "psychic") {
            const keyAttr = classItem?.system?.keyAttribute?.[0] || actor.system.details?.keyability?.value;
            if (keyAttr === "cha" || keyAttr === "int") {
                attr = keyAttr;
            }
        }

        return { attribute: attr, className, isSpellcasterOrKineticist: true };
    }

    // Check if class has key attribute defined in system data
    const keyAttr = classItem?.system?.keyAttribute?.[0] || actor.system.details?.keyability?.value;
    if (["int", "wis", "cha", "con"].includes(keyAttr)) {
        const hasSpellcasting = (actor.spellcasting?.contents?.length || 0) > 0;
        const hasImpulses = actor.items?.some(i => i.system?.traits?.value?.includes("impulse"));
        if (hasSpellcasting || hasImpulses) {
            return { attribute: keyAttr, className, isSpellcasterOrKineticist: true };
        }
    }

    // Inspect non-archetype spellcasting entries as fallback
    const classSpellcastingEntries = (actor.spellcasting?.contents || []).filter(e => {
        const name = (e.name || "").toLowerCase();
        const traits = e.system?.traits?.value || [];
        return !name.includes("archetype") && !traits.includes("archetype") && !name.includes("innate") && !name.includes("scroll");
    });

    if (classSpellcastingEntries.length > 0) {
        const entry = classSpellcastingEntries[0];
        const entryAbility = entry.system?.ability?.value || entry.attribute;
        if (entryAbility && ["int", "wis", "cha", "con"].includes(entryAbility)) {
            return { attribute: entryAbility, className: className || entry.name, isSpellcasterOrKineticist: true };
        }
    }

    return { attribute: "int", className, isSpellcasterOrKineticist: false };
}

/**
 * Retrieve the active configuration for an actor.
 * Stored in flag `pf2e-awesome-variant-rules.spellDamageMod`.
 * 
 * @param {ActorPF2e} actor 
 * @returns {{ enabled: boolean, mode: string, activeAttributes: string[], autoAttribute: string, className: string }}
 */
export function getActorSpellDamageConfig(actor) {
    const auto = autoDetectClassAttribute(actor);
    const flag = actor.getFlag(MODULE_ID, "spellDamageMod") || {};

    // By default, enable if the actor is a detected spellcaster or kineticist
    const enabled = flag.enabled !== undefined ? Boolean(flag.enabled) : auto.isSpellcasterOrKineticist;
    const mode = flag.attribute || "auto";

    let activeAttributes = [];
    if (mode === "auto") {
        activeAttributes = [auto.attribute];
    } else if (mode === "dual_int_wis") {
        activeAttributes = ["int", "wis"];
    } else if (mode === "dual_int_cha") {
        activeAttributes = ["int", "cha"];
    } else if (mode === "dual_wis_cha") {
        activeAttributes = ["wis", "cha"];
    } else if (mode === "dual_con_int") {
        activeAttributes = ["con", "int"];
    } else if (mode === "dual_con_wis") {
        activeAttributes = ["con", "wis"];
    } else if (mode === "dual_con_cha") {
        activeAttributes = ["con", "cha"];
    } else if (mode === "all") {
        activeAttributes = ["int", "wis", "cha", "con"];
    } else if (["int", "wis", "cha", "con"].includes(mode)) {
        activeAttributes = [mode];
    } else {
        activeAttributes = [auto.attribute];
    }

    return {
        enabled,
        mode,
        activeAttributes,
        autoAttribute: auto.attribute,
        className: auto.className,
        isSpellcasterOrKineticist: auto.isSpellcasterOrKineticist
    };
}

/**
 * Creates the deferred modifier function for an actor.
 * 
 * @param {ActorPF2e} actor 
 * @param {object} config 
 * @returns {Function}
 */
export function createSpellDamageModifierFunction(actor, config) {
    return function (params = {}) {
        // 1. Global setting check
        if (!game.settings.get(MODULE_ID, "spellDamageModifierVariantEnabled")) return null;

        // 2. Actor flag check
        if (!config.enabled) return null;

        // 3. Extract roll options
        const rawOptions = params.options || params.test || [];
        const options = rawOptions instanceof Set ? rawOptions : new Set(Array.isArray(rawOptions) ? rawOptions : []);

        // 4. Exclude healing rolls (e.g. Soothe or Heal healing instance)
        if (options.has("healing") || options.has("item:trait:healing")) {
            return null;
        }

        // 5. Kineticist Impulse handling
        const isImpulse = options.has("impulse") || options.has("item:trait:impulse");
        if (isImpulse) {
            const includeImpulses = game.settings.get(MODULE_ID, "spellDamageModifierIncludeImpulses");
            if (!includeImpulses) return null;

            if (!config.activeAttributes.includes("con")) return null;

            const bonus = calculateHalfModifier(actor, "con");
            if (bonus <= 0) return null;

            const ModifierClass = game.pf2e?.Modifier ?? CONFIG?.PF2E?.Modifier;
            if (!ModifierClass) return null;

            return new ModifierClass({
                slug: "spellcasting-modifier-variant",
                label: "Half Spellcasting Modifier (CON)",
                modifier: bonus,
                type: "untyped"
            });
        }

        // 6. Spellcasting check: Archetype restrictions
        const restrictToClass = game.settings.get(MODULE_ID, "spellDamageModifierRestrictToClass");
        if (restrictToClass) {
            if (options.has("spellcasting:archetype") || options.has("item:trait:archetype")) {
                return null;
            }
        }

        // 7. Match governing attribute to the spell's spellcasting attribute
        let matchingAttr = null;
        for (const attr of config.activeAttributes) {
            if (options.has(`spellcasting:attribute:${attr}`) || options.has(`origin:spellcasting:attribute:${attr}`)) {
                matchingAttr = attr;
                break;
            }
        }

        // Fallback for single attribute configurations when specific attribute option isn't attached
        if (!matchingAttr && config.activeAttributes.length === 1 && !options.has("spellcasting:archetype")) {
            matchingAttr = config.activeAttributes[0];
        }

        if (!matchingAttr) return null;

        const bonus = calculateHalfModifier(actor, matchingAttr);
        if (bonus <= 0) return null;

        const ModifierClass = game.pf2e?.Modifier ?? CONFIG?.PF2E?.Modifier;
        if (!ModifierClass) return null;

        return new ModifierClass({
            slug: "spellcasting-modifier-variant",
            label: `Half Spellcasting Modifier (${matchingAttr.toUpperCase()})`,
            modifier: bonus,
            type: "untyped"
        });
    };
}

/**
 * Injects the deferred modifier into the actor's synthetics during data preparation.
 * 
 * @param {ActorPF2e} actor 
 */
export function injectSpellDamageModifierSynthetic(actor) {
    if (!actor || actor.type !== "character") return;
    if (!game.settings.get(MODULE_ID, "spellDamageModifierVariantEnabled")) return;

    const config = getActorSpellDamageConfig(actor);
    if (!config.enabled) return;

    const deferredMod = createSpellDamageModifierFunction(actor, config);

    // Register on spell-damage selector
    actor.synthetics.modifiers["spell-damage"] = actor.synthetics.modifiers["spell-damage"] || [];
    actor.synthetics.modifiers["spell-damage"].push(deferredMod);

    // Register on impulse-damage selector
    actor.synthetics.modifiers["impulse-damage"] = actor.synthetics.modifiers["impulse-damage"] || [];
    actor.synthetics.modifiers["impulse-damage"].push(deferredMod);
}

/**
 * Initialize Character Sheet UI Integration.
 * Injects a compact, cream-and-red styled status and control bar.
 */
export function registerSpellDamageSheetIntegration() {
    Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
        if (!game.settings.get(MODULE_ID, "spellDamageModifierVariantEnabled")) return;

        const actor = sheet.actor;
        if (!actor || actor.type !== "character") return;

        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root || !root.querySelector) return;

        // Prevent duplicate rendering
        if (root.querySelector(".pf2e-spell-damage-variant-bar")) return;

        const config = getActorSpellDamageConfig(actor);
        const auto = autoDetectClassAttribute(actor);

        // Calculate potential bonuses for display
        const intBonus = calculateHalfModifier(actor, "int");
        const wisBonus = calculateHalfModifier(actor, "wis");
        const chaBonus = calculateHalfModifier(actor, "cha");
        const conBonus = calculateHalfModifier(actor, "con");
        const autoBonus = calculateHalfModifier(actor, auto.attribute);

        // Find injection container (Spellcasting tab or Actions tab for pure Kineticists)
        const spellcastingTab = root.querySelector('.tab[data-tab="spellcasting"], .tab[data-tab="spells"]');
        const actionsTab = root.querySelector('.tab[data-tab="actions"]');

        let targetContainer = spellcastingTab;
        if (!targetContainer && auto.attribute === "con" && actionsTab) {
            targetContainer = actionsTab;
        }

        if (!targetContainer) return;

        // Create Compact Bar UI
        const bar = document.createElement("div");
        bar.className = "pf2e-spell-damage-variant-bar";

        let currentBonusDisplay = "0";
        if (config.mode === "auto") {
            currentBonusDisplay = `+${autoBonus} ${auto.attribute.toUpperCase()}`;
        } else if (config.mode.startsWith("dual_")) {
            currentBonusDisplay = "Dual";
        } else if (config.mode === "all") {
            currentBonusDisplay = "Universal";
        } else {
            currentBonusDisplay = `+${calculateHalfModifier(actor, config.mode)} ${config.mode.toUpperCase()}`;
        }

        const autoLabel = auto.className
            ? `${auto.className} (${auto.attribute.toUpperCase()}: +${autoBonus})`
            : `${auto.attribute.toUpperCase()} (+${autoBonus})`;

        bar.innerHTML = `
            <div class="variant-bar-content">
                <div class="variant-bar-left">
                    <label class="variant-toggle" title="Add half primary spellcasting modifier (floor(mod / 2)) to class spells & impulses. Excludes archetypes.">
                        <input type="checkbox" class="spell-damage-toggle" ${config.enabled ? "checked" : ""} />
                        <span class="variant-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Half Spell Mod Dmg:</span>
                    </label>
                    <span class="variant-badge ${config.enabled ? 'active' : 'inactive'}" title="${config.enabled ? 'Active damage bonus' : 'Variant bonus disabled for this character'}">
                        ${config.enabled ? currentBonusDisplay : 'Off'}
                    </span>
                </div>
                <div class="variant-bar-right">
                    <label for="spell-damage-attr-select" class="attr-label">Stat:</label>
                    <select id="spell-damage-attr-select" class="spell-damage-attr-select" title="Governing attribute for the damage bonus (auto-detects class attribute; supports dual-class)">
                        <option value="auto" ${config.mode === "auto" ? "selected" : ""}>Auto: ${autoLabel}</option>
                        <option value="int" ${config.mode === "int" ? "selected" : ""}>INT (+${intBonus})</option>
                        <option value="wis" ${config.mode === "wis" ? "selected" : ""}>WIS (+${wisBonus})</option>
                        <option value="cha" ${config.mode === "cha" ? "selected" : ""}>CHA (+${chaBonus})</option>
                        <option value="con" ${config.mode === "con" ? "selected" : ""}>CON (+${conBonus})</option>
                        <option value="dual_int_wis" ${config.mode === "dual_int_wis" ? "selected" : ""}>Dual: INT & WIS</option>
                        <option value="dual_int_cha" ${config.mode === "dual_int_cha" ? "selected" : ""}>Dual: INT & CHA</option>
                        <option value="dual_wis_cha" ${config.mode === "dual_wis_cha" ? "selected" : ""}>Dual: WIS & CHA</option>
                        <option value="dual_con_int" ${config.mode === "dual_con_int" ? "selected" : ""}>Dual: CON & INT</option>
                        <option value="dual_con_wis" ${config.mode === "dual_con_wis" ? "selected" : ""}>Dual: CON & WIS</option>
                        <option value="dual_con_cha" ${config.mode === "dual_con_cha" ? "selected" : ""}>Dual: CON & CHA</option>
                        <option value="all" ${config.mode === "all" ? "selected" : ""}>Universal (Any)</option>
                    </select>
                </div>
            </div>
        `;

        // Event Listeners
        const toggleInput = bar.querySelector(".spell-damage-toggle");
        const selectElement = bar.querySelector(".spell-damage-attr-select");

        toggleInput?.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await actor.setFlag(MODULE_ID, "spellDamageMod", {
                enabled: toggleInput.checked,
                attribute: selectElement.value
            });
            ui.notifications.info(`PF2e Awesome Variant Rules | Spell Damage Bonus ${toggleInput.checked ? 'enabled' : 'disabled'} for ${actor.name}.`);
        });

        selectElement?.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await actor.setFlag(MODULE_ID, "spellDamageMod", {
                enabled: toggleInput.checked,
                attribute: selectElement.value
            });
            ui.notifications.info(`PF2e Awesome Variant Rules | Governing Attribute set to ${selectElement.options[selectElement.selectedIndex].text} for ${actor.name}.`);
        });

        // Insert at the top of the tab content or before the spellcasting entries
        const insertTarget = targetContainer.querySelector(".spellcasting-entries, .actions-list, header, .header") || targetContainer.firstChild;
        if (insertTarget) {
            targetContainer.insertBefore(bar, insertTarget);
        } else {
            targetContainer.appendChild(bar);
        }
    });
}

/**
 * Main initialization for the spell damage modifier module.
 */
export function initSpellDamageModifier() {
    // 1. Wrap ActorPF2e.prototype.prepareDerivedData to inject synthetic modifiers
    const ActorPF2eClass = CONFIG.Actor.documentClass;
    if (ActorPF2eClass?.prototype) {
        const originalPrepareDerivedData = ActorPF2eClass.prototype.prepareDerivedData;
        ActorPF2eClass.prototype.prepareDerivedData = function () {
            originalPrepareDerivedData.call(this);
            if (this.type === "character") {
                injectSpellDamageModifierSynthetic(this);
            }
        };
    }

    // 2. Character Sheet Integration
    registerSpellDamageSheetIntegration();

    // 3. Clean up any obsolete temporary feat item if present in world
    if (game.user.isGM) {
        const obsoleteFeats = game.items.filter(i => i.flags?.[MODULE_ID]?.isModuleItem && i.name === "Variant: Spellcasting Damage Modifier");
        if (obsoleteFeats.length > 0) {
            Item.deleteDocuments(obsoleteFeats.map(i => i.id));
        }
    }

    console.log("PF2e Awesome Variant Rules | Spell Damage Modifier Variant Initialized.");
}
