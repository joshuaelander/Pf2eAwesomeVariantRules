/**
 * PF2e Awesome Variant Rules: Smart Feat Browser Enhancements
 *
 * Passively captures which Feats-tab group/slot was clicked on `CharacterSheetPF2e`
 * (never blocking PF2e's native click handler) and enhances PF2e's live Compendium Browser
 * filter object when `compendiumBrowser.openTab("feat", ...)` / `tabs.feat.open(...)` runs:
 *
 * - Dual Class Feats (automatic when Dual Class is enabled):
 *   Selects `Class Feat` category and adds the second class trait + `Archetype` (`or` conjunction).
 * - Ancestry Paragon Feats (automatic when Ancestry Paragon is enabled):
 *   Selects `Ancestry Feat` category and adds the character's ancestry + heritage traits (`or` conjunction).
 * - Smart Free Archetype Filtering (optional setting, off by default):
 *   - Before picking a dedication (or Level 2 with no dedication): filters to `Class Feat` with
 *     `Archetype` + `Dedication` (`and` conjunction).
 *   - Once a dedication is chosen (Level > 2 slots or header Browse): selects `Class Feat` + `Skill Feat`,
 *     includes `Archetype`, excludes `Dedication` (`not: true`), and scopes results to feats in the
 *     chosen dedication(s)' transitive prerequisite chain (with a one-click Clear button in the browser).
 * - Sort Feats by Level Descending (optional setting, off by default):
 *   Sets `order.by = "level"` and `order.direction = "desc"` so highest-level feats appear at the top.
 */

import { isDualClassEnabled, getSecondaryClassData } from "./dual-class.js";
import { isAncestryParagonEnabled } from "./ancestry-paragon.js";

const MODULE_ID = "pf2e-awesome-variant-rules";

/** Transient context from the most recent Feats-tab Browse click */
let pendingBrowseContext = null;

/** Guard against wrapping Compendium Browser methods multiple times */
let browserWrapped = false;

/** Cached archetype feat metadata across compendium packs: Map<uuid, { uuid, name, normName, traits, prereqs }> */
let archetypeFeatIndexCache = null;

/* ------------------------------------------------------------------------- */
/* 1. SETTINGS REGISTRATION                                                  */
/* ------------------------------------------------------------------------- */

export function registerSmartFeatBrowserSettings() {
    game.settings.register(MODULE_ID, "featBrowserSortLevelDesc", {
        name: "Sort Feats Browser by Level (Descending)",
        hint: "When opening the Compendium Browser from a character sheet's Feats tab, automatically sort results by Level descending so the highest-level feats appear at the top.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "smartArchetypeBrowseEnabled", {
        name: "Smart Free Archetype Browser Filtering",
        hint: "Improves PF2e's Free Archetype Browse button: includes both Archetype and Dedication traits before choosing a dedication; once you have a dedication, excludes Dedication feats on higher-level slots and filters to feats from your chosen archetype(s) with a one-click clear button.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
}

export function isSortLevelDescEnabled() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "featBrowserSortLevelDesc"));
    } catch {
        return false;
    }
}

export function isSmartArchetypeBrowseEnabled() {
    try {
        return Boolean(game.settings.get(MODULE_ID, "smartArchetypeBrowseEnabled"));
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------------- */
/* 2. TRAIT & ARCHETYPE PREREQUISITE HELPERS                                 */
/* ------------------------------------------------------------------------- */

function normalizeSlug(raw) {
    return String(raw || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeName(raw) {
    return String(raw || "")
        .toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Collect all ancestry & versatile heritage traits for a character actor.
 * @param {Actor} actor
 * @returns {string[]}
 */
function collectActorAncestryTraits(actor) {
    const traits = new Set();
    const add = (val) => {
        const s = normalizeSlug(val);
        if (s) traits.add(s);
    };

    // Primary ancestry
    add(actor?.ancestry?.slug);
    for (const t of actor?.ancestry?.system?.traits?.value ?? []) add(t);

    // Heritage / Versatile Heritage
    add(actor?.heritage?.slug);
    for (const t of actor?.heritage?.system?.traits?.value ?? []) add(t);

    // Actor-level traits (includes granted versatile heritage & adopted ancestry traits)
    for (const t of actor?.system?.traits?.value ?? []) add(t);

    // Also inspect native `ancestry` FeatGroup filter if it exposes trait slugs
    const ancestryGroup = actor?.feats?.get?.("ancestry");
    if (Array.isArray(ancestryGroup?.featFilter)) {
        for (const entry of ancestryGroup.featFilter) {
            if (typeof entry !== "string") continue;
            if (entry.startsWith("traits-")) add(entry.slice("traits-".length));
            else if (entry.startsWith("trait-")) add(entry.slice("trait-".length));
        }
    }

    // Remove non-ancestry generic creature traits
    traits.delete("humanoid");
    traits.delete("common");
    traits.delete("uncommon");
    traits.delete("rare");
    traits.delete("unique");

    return Array.from(traits);
}

/**
 * Find all Dedication feats currently owned by the actor.
 * @param {Actor} actor
 * @returns {Item[]}
 */
function getActorDedicationFeats(actor) {
    return (actor?.itemTypes?.feat ?? []).filter(feat => {
        const traits = feat.system?.traits?.value ?? [];
        return Array.isArray(traits) && traits.includes("dedication");
    });
}

/**
 * Build (and cache) an index of all archetype feats across Item compendiums and World Items,
 * storing their traits and prerequisite strings so we can match follow-up feats for any dedication.
 *
 * @returns {Promise<Map<string, { uuid: string, name: string, normName: string, traits: string[], prereqs: string[] }>>}
 */
async function getArchetypeFeatIndex() {
    if (archetypeFeatIndexCache) return archetypeFeatIndexCache;

    const indexMap = new Map();

    const extractPrereqs = (rawPrereqs) => {
        const list = Array.isArray(rawPrereqs)
            ? rawPrereqs
            : (Array.isArray(rawPrereqs?.value) ? rawPrereqs.value : []);
        return list
            .map(p => (typeof p === "string" ? p : p?.value))
            .filter(Boolean)
            .map(normalizeName);
    };

    const addEntry = (uuid, name, traitsRaw, prereqsRaw) => {
        const traits = Array.isArray(traitsRaw) ? traitsRaw : [];
        if (!traits.includes("archetype")) return;
        indexMap.set(uuid, {
            uuid,
            name: String(name || ""),
            normName: normalizeName(name),
            traits,
            prereqs: extractPrereqs(prereqsRaw)
        });
    };

    // 1. World feat items (homebrew archetypes)
    for (const item of game.items ?? []) {
        if (item.type !== "feat") continue;
        addEntry(item.uuid, item.name, item.system?.traits?.value, item.system?.prerequisites);
    }

    // 2. Compendium feat packs
    for (const pack of game.packs ?? []) {
        if (pack.documentName !== "Item") continue;
        const col = pack.collection || "";
        if (col.startsWith("pf2e.") && !col.includes("feat") && !col.includes("ancestry") && !col.includes("class")) {
            continue;
        }

        let idx;
        try {
            idx = await pack.getIndex({
                fields: ["type", "name", "system.traits.value", "system.prerequisites.value"]
            });
        } catch {
            continue;
        }

        for (const entry of idx) {
            if (entry.type !== "feat") continue;
            const uuid = entry.uuid || `Compendium.${pack.collection}.Item.${entry._id}`;
            addEntry(uuid, entry.name, entry.system?.traits?.value, entry.system?.prerequisites);
        }
    }

    archetypeFeatIndexCache = indexMap;
    return indexMap;
}

/**
 * Compute the transitive set of archetype feat UUIDs & normalized names belonging to the
 * actor's chosen dedication(s). Includes both direct dedication follow-ups and multi-step chains
 * (e.g. "Beastmaster Dedication" -> "Mature Beastmaster Companion" -> "Incredible Beastmaster's Companion").
 *
 * @param {Actor} actor
 * @param {Item[]} dedications
 * @returns {Promise<{ uuids: Set<string>, names: Set<string>, dedicationNames: string[] }>}
 */
async function computeArchetypeMatchingFeats(actor, dedications) {
    const featIndex = await getArchetypeFeatIndex();
    const dedicationNames = dedications.map(d => d.name);

    // Seed with the actor's dedication names plus any archetype feats the actor already owns
    const knownNames = new Set(dedicationNames.map(normalizeName));
    for (const feat of actor?.itemTypes?.feat ?? []) {
        const traits = feat.system?.traits?.value ?? [];
        if (Array.isArray(traits) && traits.includes("archetype")) {
            knownNames.add(normalizeName(feat.name));
        }
    }

    const matchingUuids = new Set();
    const matchingNames = new Set();

    let changed = true;
    let guard = 0;
    while (changed && guard < 8) {
        changed = false;
        guard++;

        for (const entry of featIndex.values()) {
            if (matchingUuids.has(entry.uuid)) continue;
            if (entry.traits.includes("dedication")) continue;
            if (entry.prereqs.length === 0) continue;

            const matches = entry.prereqs.some(prereqStr => {
                if (knownNames.has(prereqStr)) return true;
                for (const name of knownNames) {
                    if (name.length >= 4 && prereqStr.includes(name)) return true;
                }
                return false;
            });

            if (matches) {
                matchingUuids.add(entry.uuid);
                if (entry.normName) {
                    matchingNames.add(entry.normName);
                    if (!knownNames.has(entry.normName)) {
                        knownNames.add(entry.normName);
                        changed = true;
                    }
                }
            }
        }
    }

    return { uuids: matchingUuids, names: matchingNames, dedicationNames };
}

/**
 * Check whether a Compendium Browser index entry matches the active archetype scope.
 * Matches by UUID or normalized name for resilience across pack UUID formats.
 *
 * @param {object} entry
 * @param {{ uuids: Set<string>, names: Set<string> }} scope
 * @returns {boolean}
 */
function entryMatchesArchetypeScope(entry, scope) {
    if (!entry || !scope) return true;
    if (entry.uuid && scope.uuids?.has(entry.uuid)) return true;
    const norm = normalizeName(entry.name);
    if (norm && scope.names?.has(norm)) return true;
    return false;
}

/* ------------------------------------------------------------------------- */
/* 3. PASSIVE FEATS-TAB CLICK CONTEXT CAPTURE                                */
/* ------------------------------------------------------------------------- */

/**
 * Identify which feat group & optional slot level a clicked Browse button belongs to
 * WITHOUT interfering with PF2e's native click event.
 *
 * @param {HTMLElement} target
 * @param {Actor} actor
 * @returns {{ groupId: string|null, slotId: string|null, slotLevel: number|null }|null}
 */
function detectFeatBrowseTarget(target, actor) {
    if (!target || typeof target.closest !== "function") return null;

    const browseEl = target.closest(
        '[data-action="browse-feats"], [data-action="open-compendium"], a.browse, button.browse, [data-filter], .browse-btn'
    );

    let trigger = browseEl;
    if (!trigger) {
        const clickable = target.closest("a, button");
        if (clickable) {
            const text = `${clickable.textContent || ""} ${clickable.title || ""} ${clickable.getAttribute("aria-label") || ""}`.toLowerCase();
            if (text.includes("browse") || clickable.querySelector(".fa-magnifying-glass, .fa-search")) {
                trigger = clickable;
            }
        }
    }
    if (!trigger) return null;

    // 1. Check direct slot ID (e.g., `dualclass-6`, `ancestryparagon-3`, `archetype-4`, `class-8`)
    const slotContainer = trigger.closest("[data-slot-id]") || trigger;
    const slotId = slotContainer?.dataset?.slotId || trigger.dataset?.slotId || null;
    let groupId = null;
    let slotLevel = null;

    if (slotId) {
        const slotMatch = /^([a-z0-9_-]+)-(\d+)$/i.exec(slotId);
        if (slotMatch) {
            groupId = slotMatch[1].toLowerCase();
            slotLevel = Number(slotMatch[2]);
        }
    }

    if (!slotLevel) {
        const lvlAttr = trigger.dataset?.level ?? trigger.dataset?.maxLevel ?? slotContainer?.dataset?.level;
        const parsedLvl = Number(lvlAttr);
        if (Number.isFinite(parsedLvl) && parsedLvl > 0) {
            slotLevel = parsedLvl;
        }
    }

    // 2. Check explicit group container attributes
    if (!groupId) {
        const groupContainer = trigger.closest("[data-group-id], [data-category-id], [data-feat-group], [data-group]");
        const rawGroup = groupContainer?.dataset?.groupId
            ?? groupContainer?.dataset?.categoryId
            ?? groupContainer?.dataset?.featGroup
            ?? groupContainer?.dataset?.group
            ?? trigger.dataset?.groupId
            ?? trigger.dataset?.group
            ?? null;
        if (rawGroup) {
            groupId = String(rawGroup).toLowerCase().trim();
        }
    }

    // 3. Fallback: inspect the nearest heading / header row (NEVER climbing up to `.tab`)
    if (!groupId) {
        let headerEl = trigger.closest("header, .header");
        if (!headerEl) {
            const listEl = trigger.closest("ol, ul, .feat-slots, .feats-list, .slot-list");
            if (listEl?.previousElementSibling?.matches("header, .header, h3, h4")) {
                headerEl = listEl.previousElementSibling;
            }
        }
        const headingText = (headerEl?.textContent || "").toLowerCase();
        const dualData = getSecondaryClassData(actor);
        const secondName = (dualData?.itemData?.name || "").toLowerCase();

        if (headingText.includes("(dual class)") || (secondName && headingText.includes(`${secondName} feats`))) {
            groupId = "dualclass";
        } else if (headingText.includes("ancestry paragon")) {
            groupId = "ancestryparagon";
        } else if (headingText.includes("archetype")) {
            groupId = "archetype";
        } else if (headingText.includes("ancestry")) {
            groupId = "ancestry";
        } else if (headingText.includes("class")) {
            groupId = "class";
        } else if (headingText.includes("skill")) {
            groupId = "skill";
        } else if (headingText.includes("general")) {
            groupId = "general";
        }
    }

    return { groupId, slotId, slotLevel };
}

/**
 * Attach a passive capture listener on `CharacterSheetPF2e` Feats tab.
 */
function registerFeatsTabContextCapture() {
    Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
        const actor = sheet?.actor ?? sheet?.document;
        if (!actor || actor.type !== "character") return;

        const root = html instanceof HTMLElement ? html : (html?.[0] ?? sheet?.element);
        if (!root || !root.querySelector) return;

        const featsTab = root.querySelector('.tab[data-tab="feats"]');
        if (!featsTab || featsTab.dataset.pf2eAvrBrowseSpy === "1") return;
        featsTab.dataset.pf2eAvrBrowseSpy = "1";

        featsTab.addEventListener("click", (ev) => {
            const detected = detectFeatBrowseTarget(ev.target, actor);
            if (!detected) return;
            pendingBrowseContext = {
                actor,
                groupId: detected.groupId,
                slotId: detected.slotId,
                slotLevel: detected.slotLevel,
                timestamp: Date.now()
            };
        }, { capture: true, passive: true });
    });
}

function consumePendingBrowseContext() {
    if (!pendingBrowseContext) return null;
    const ctx = pendingBrowseContext;
    pendingBrowseContext = null;
    if (Date.now() - ctx.timestamp > 1500) return null;
    return ctx;
}

/* ------------------------------------------------------------------------- */
/* 4. FILTER PATCHING & INDEX-DATA SCOPING                                   */
/* ------------------------------------------------------------------------- */

/**
 * Build the filter patch specification for a given Feats-tab Browse context.
 *
 * @param {{ actor: Actor, groupId: string|null, slotId: string|null, slotLevel: number|null }} ctx
 * @returns {Promise<object|null>}
 */
async function buildBrowsePatchSpec(ctx) {
    const { actor, groupId, slotLevel } = ctx;
    const sortLevelDesc = isSortLevelDescEnabled();
    const spec = {
        sortLevelDesc,
        categories: null,
        replaceCategories: false,
        traits: null,
        conjunction: null,
        archetypeScope: null
    };

    let hasAnyChange = sortLevelDesc;

    // 1. Dual Class Feats -> Class Feat + [secondClassSlug, "archetype"] (OR)
    if (groupId === "dualclass" && isDualClassEnabled()) {
        const dualData = getSecondaryClassData(actor);
        const secondSlug = normalizeSlug(dualData?.itemData?.system?.slug || dualData?.slug || dualData?.itemData?.name);
        if (secondSlug) {
            spec.categories = ["class"];
            spec.replaceCategories = true;
            spec.traits = [
                { value: secondSlug, not: false },
                { value: "archetype", not: false }
            ];
            spec.conjunction = "or";
            hasAnyChange = true;
        }
    }

    // 2. Ancestry Paragon Feats -> Ancestry Feat + character's ancestry/heritage traits (OR)
    else if (groupId === "ancestryparagon" && isAncestryParagonEnabled()) {
        const ancestryTraits = collectActorAncestryTraits(actor);
        spec.categories = ["ancestry"];
        spec.replaceCategories = true;
        if (ancestryTraits.length > 0) {
            spec.traits = ancestryTraits.map(t => ({ value: t, not: false }));
            spec.conjunction = "or";
        }
        hasAnyChange = true;
    }

    // 3. Free Archetype -> Smart Dedication vs Chosen Archetype Follow-up Filtering
    else if (groupId === "archetype" && isSmartArchetypeBrowseEnabled()) {
        const dedications = getActorDedicationFeats(actor);
        const actorLevel = Number(actor?.level ?? actor?.system?.details?.level?.value ?? 1);
        const isFollowUpSlot = dedications.length > 0 && (slotLevel === null ? actorLevel > 2 : slotLevel > 2);

        if (!isFollowUpSlot) {
            spec.categories = ["class"];
            spec.replaceCategories = true;
            spec.traits = [
                { value: "archetype", not: false },
                { value: "dedication", not: false }
            ];
            spec.conjunction = "and";
            hasAnyChange = true;
        } else {
            const matchResult = await computeArchetypeMatchingFeats(actor, dedications);
            spec.categories = ["class", "skill"];
            spec.replaceCategories = true;
            spec.traits = [
                { value: "archetype", not: false },
                { value: "dedication", not: true }
            ];
            spec.conjunction = "and";
            if (matchResult.uuids.size > 0) {
                spec.archetypeScope = {
                    uuids: matchResult.uuids,
                    names: matchResult.names,
                    dedicationNames: matchResult.dedicationNames
                };
            }
            hasAnyChange = true;
        }
    }

    return hasAnyChange ? spec : null;
}

/**
 * Mutate PF2e's live filter object in-place while strictly respecting its existing structure.
 *
 * @param {object} filterObj
 * @param {object} spec
 */
function applyPatchToFilterObject(filterObj, spec) {
    if (!filterObj || typeof filterObj !== "object" || !spec) return;

    // 1. Sort by Level descending
    if (spec.sortLevelDesc) {
        if (filterObj.order && typeof filterObj.order === "object") {
            filterObj.order.by = "level";
            filterObj.order.direction = "desc";
        } else {
            filterObj.order = { by: "level", direction: "desc" };
        }
    }

    // 2. Category checkboxes
    if (Array.isArray(spec.categories) && spec.categories.length > 0) {
        const catBox = filterObj.checkboxes?.category;
        if (catBox && typeof catBox === "object") {
            if (catBox.options && typeof catBox.options === "object") {
                const selectedKeys = [];
                for (const [key, opt] of Object.entries(catBox.options)) {
                    const shouldSelect = spec.replaceCategories
                        ? spec.categories.includes(key)
                        : (Boolean(opt.selected) || spec.categories.includes(key));
                    opt.selected = shouldSelect;
                    if (shouldSelect) selectedKeys.push(key);
                }
                catBox.selected = selectedKeys;
                catBox.isExpanded = true;
            } else {
                catBox.selected = [...spec.categories];
            }
        } else if (Array.isArray(filterObj.category)) {
            filterObj.category = [...spec.categories];
        }
    }

    // 3. Traits multiselect (strictly matching against live PF2e options when present)
    if (Array.isArray(spec.traits) && spec.traits.length > 0) {
        const traitsMulti = filterObj.multiselects?.traits;
        if (traitsMulti && typeof traitsMulti === "object") {
            const liveOptions = Array.isArray(traitsMulti.options) ? traitsMulti.options : [];
            const selected = [];

            for (const item of spec.traits) {
                const found = liveOptions.length > 0
                    ? liveOptions.find(o => o.value === item.value)
                    : { label: item.value, value: item.value };
                if (!found) continue;

                const entry = { label: found.label, value: found.value };
                if (item.not) entry.not = true;

                if (!selected.some(s => s.value === entry.value)) {
                    selected.push(entry);
                }
            }

            if (selected.length > 0) {
                traitsMulti.selected = selected;
            }
            if (spec.conjunction) {
                traitsMulti.conjunction = spec.conjunction;
            }
        } else if (filterObj.traits && typeof filterObj.traits === "object") {
            if (Array.isArray(filterObj.traits.selected)) {
                filterObj.traits.selected = spec.traits.map(t => ({
                    label: t.value,
                    value: t.value,
                    ...(t.not ? { not: true } : {})
                }));
            } else if (Array.isArray(filterObj.traits.values)) {
                filterObj.traits.values = spec.traits.filter(t => !t.not).map(t => t.value);
            }
            if (spec.conjunction) {
                filterObj.traits.conjunction = spec.conjunction;
            }
        }
    }
}

/**
 * Extract the live filter object from arguments passed to `tabs.feat.open(...)` or `openTab("feat", ...)`.
 * @param {any} arg
 * @returns {object|null}
 */
function extractFilterFromArg(arg) {
    if (!arg || typeof arg !== "object") return null;
    if (arg.multiselects || arg.checkboxes || arg.order || arg.sliders) return arg;
    if (arg.filter && typeof arg.filter === "object") return arg.filter;
    return null;
}

/**
 * Find the property descriptor for `propName` on `obj` or its prototype chain.
 */
function findPropertyDescriptor(obj, propName) {
    let cur = obj;
    while (cur && cur !== Object.prototype) {
        const desc = Object.getOwnPropertyDescriptor(cur, propName);
        if (desc) return desc;
        cur = Object.getPrototypeOf(cur);
    }
    return null;
}

/**
 * Apply the active archetype scope directly to `featTab.indexData` (when writable) while
 * keeping an untouched backup in `featTab._pf2eAvrFullIndexData`.
 *
 * Works seamlessly with PF2e's Svelte Compendium Browser even if `filterIndexData` is private.
 */
function applyIndexDataScope(featTab) {
    if (!featTab || featTab._pf2eAvrIndexDataIsGetter) return;
    const scope = featTab._pf2eAvrArchetypeScope;
    if (!scope) return;

    if (!Array.isArray(featTab.indexData) || featTab.indexData.length === 0) return;

    // Preserve full array once (or refresh backup if PF2e loaded a larger full set)
    if (!Array.isArray(featTab._pf2eAvrFullIndexData) || featTab.indexData.length > featTab._pf2eAvrFullIndexData.length) {
        featTab._pf2eAvrFullIndexData = featTab.indexData;
    }

    try {
        featTab.indexData = featTab._pf2eAvrFullIndexData.filter(entry => entryMatchesArchetypeScope(entry, scope));
    } catch {
        // Property might be non-writable; getter / getIndexData / DOM fallback will handle it
    }
}

/**
 * Restore `featTab.indexData` back to the full untouched dataset when clearing the archetype scope.
 */
function restoreIndexDataScope(featTab) {
    if (!featTab || featTab._pf2eAvrIndexDataIsGetter) return;
    if (Array.isArray(featTab._pf2eAvrFullIndexData)) {
        try {
            featTab.indexData = featTab._pf2eAvrFullIndexData;
        } catch { /* ignore */ }
    }
}

function clearArchetypeScope(featTab) {
    if (featTab) {
        featTab._pf2eAvrArchetypeScope = null;
        restoreIndexDataScope(featTab);
    }
    removeArchetypeScopeBanner();
}

/* ------------------------------------------------------------------------- */
/* 5. ARCHETYPE SCOPE BANNER INSIDE COMPENDIUM BROWSER                       */
/* ------------------------------------------------------------------------- */

function removeArchetypeScopeBanner(root = null) {
    const scopeRoot = root || game.pf2e?.compendiumBrowser?.element || document;
    const container = scopeRoot instanceof HTMLElement ? scopeRoot : scopeRoot?.[0];
    container?.querySelectorAll?.(".pf2e-avr-archetype-scope-banner")?.forEach(el => el.remove());
}

/**
 * Display a compact dismissible banner inside the Compendium Browser whenever results are
 * scoped to a character's chosen Dedication archetype(s), and wire both its Clear button
 * and PF2e's native "Clear All Filters" button so clearing ALWAYS refreshes Svelte immediately.
 */
function syncArchetypeScopeBanner(featTab, reopenFn) {
    const browser = game.pf2e?.compendiumBrowser;
    const rootEl = browser?.element instanceof HTMLElement ? browser.element : browser?.element?.[0];
    if (!rootEl || !rootEl.querySelector) return;

    removeArchetypeScopeBanner(rootEl);

    // Ensure clicking PF2e's own "Clear All Filters" button always restores our full indexData too
    if (rootEl.dataset.pf2eAvrClearSpy !== "1") {
        rootEl.dataset.pf2eAvrClearSpy = "1";
        rootEl.addEventListener("click", (ev) => {
            const btn = ev.target?.closest?.("button");
            if (!btn) return;
            const label = (btn.textContent || "").toLowerCase();
            if (label.includes("clear all filters") || btn.classList.contains("clear-filters")) {
                clearArchetypeScope(featTab);
            }
        }, { capture: true, passive: true });
    }

    const scope = featTab?._pf2eAvrArchetypeScope;
    if (!scope || !scope.dedicationNames?.length) return;

    const activeTabName = browser?.activeTab?.tabName ?? browser?.activeTab ?? null;
    if (activeTabName && activeTabName !== "feat") return;

    const resultsArea = rootEl.querySelector(
        ".result-list, .item-list, .browser-results, .content-box, .tab.active, .window-content .content"
    ) || rootEl.querySelector(".window-content");
    if (!resultsArea) return;

    const esc = foundry.utils.escapeHTML;
    const banner = document.createElement("div");
    banner.className = "pf2e-avr-archetype-scope-banner";
    banner.innerHTML = `
        <span class="scope-text">
            <strong>Archetype Filter:</strong> ${esc(scope.dedicationNames.join(", "))}
        </span>
        <button type="button" class="scope-clear-btn" title="Show all Archetype feats (including Dedications)">
            Clear Archetype Filter
        </button>
    `;

    banner.querySelector(".scope-clear-btn")?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // Capture current level slider max before clearing so we preserve the slot level cap
        const prevMaxLevel = featTab.filterData?.sliders?.level?.values?.max ?? null;
        const prevDirection = featTab.filterData?.order?.direction ?? (isSortLevelDescEnabled() ? "desc" : "asc");

        // 1. Clear archetype scope and restore the full indexData array
        clearArchetypeScope(featTab);

        // 2. Build a BRAND-NEW filter object (so Svelte 5 reactive state definitely detects the change!)
        //    keeping Class + Skill feats and `Archetype` trait, while removing the `!Dedication` exclusion.
        let freshFilter = null;
        try {
            if (typeof featTab.getFilterData === "function") {
                freshFilter = await featTab.getFilterData();
            } else if (featTab.filterData) {
                freshFilter = foundry.utils.deepClone(featTab.filterData);
            }
        } catch {
            freshFilter = featTab.filterData ? foundry.utils.deepClone(featTab.filterData) : null;
        }

        if (freshFilter) {
            applyPatchToFilterObject(freshFilter, {
                sortLevelDesc: prevDirection === "desc",
                categories: ["class", "skill"],
                replaceCategories: true,
                traits: [{ value: "archetype", not: false }],
                conjunction: "and"
            });
            if (prevMaxLevel && freshFilter.sliders?.level?.values) {
                freshFilter.sliders.level.values.max = prevMaxLevel;
            }
        }

        // 3. Re-open with the fresh filter via PF2e's native open method so Svelte re-runs its derived list
        try {
            if (reopenFn && freshFilter) {
                await reopenFn(freshFilter);
            } else if (typeof browser?.openTab === "function") {
                await browser.openTab("feat", freshFilter);
            } else {
                browser?.render?.({ force: true });
            }
        } catch {
            try { browser?.render?.({ force: true }); } catch { /* ignore */ }
        }
    });

    resultsArea.prepend(banner);
}

/* ------------------------------------------------------------------------- */
/* 6. WRAP COMPENDIUM BROWSER METHODS                                        */
/* ------------------------------------------------------------------------- */

function wrapCompendiumBrowser() {
    if (browserWrapped) return;
    const browser = game.pf2e?.compendiumBrowser;
    const featTab = browser?.tabs?.feat;
    if (!browser || !featTab) return;

    // 1. Wrap `featTab.indexData` getter if it is defined as an accessor on the prototype
    //    (handles PF2e v7/v8 private `#indexData` fields transparently!)
    const indexDataDesc = findPropertyDescriptor(featTab, "indexData");
    if (indexDataDesc?.get && indexDataDesc.configurable) {
        const origGet = indexDataDesc.get;
        const origSet = indexDataDesc.set;
        featTab._pf2eAvrIndexDataIsGetter = true;
        Object.defineProperty(featTab, "indexData", {
            configurable: true,
            enumerable: indexDataDesc.enumerable ?? true,
            get() {
                const full = origGet.call(this);
                const scope = this._pf2eAvrArchetypeScope;
                if (scope && Array.isArray(full)) {
                    return full.filter(entry => entryMatchesArchetypeScope(entry, scope));
                }
                return full;
            },
            ...(origSet ? { set(val) { origSet.call(this, val); } } : {})
        });
    }

    // 2. Wrap `featTab.currentIndex` getter if present
    const currentIndexDesc = findPropertyDescriptor(featTab, "currentIndex");
    if (currentIndexDesc?.get && currentIndexDesc.configurable) {
        const origCurrentGet = currentIndexDesc.get;
        Object.defineProperty(featTab, "currentIndex", {
            configurable: true,
            enumerable: currentIndexDesc.enumerable ?? true,
            get() {
                const list = origCurrentGet.call(this);
                const scope = this._pf2eAvrArchetypeScope;
                if (scope && Array.isArray(list)) {
                    return list.filter(entry => entryMatchesArchetypeScope(entry, scope));
                }
                return list;
            }
        });
    }

    // 3. Wrap `featTab.loadData` so first-time initialization captures the full indexData
    //    and immediately scopes it before Svelte renders.
    if (typeof featTab.loadData === "function") {
        const originalLoadData = featTab.loadData.bind(featTab);
        featTab.loadData = async function (...args) {
            const res = await originalLoadData(...args);
            if (!this._pf2eAvrIndexDataIsGetter && Array.isArray(this.indexData) && this.indexData.length > 0) {
                this._pf2eAvrFullIndexData = this.indexData;
                if (this._pf2eAvrArchetypeScope) {
                    applyIndexDataScope(this);
                }
            }
            return res;
        };
    }

    // 4. Wrap `featTab.filterIndexData` (for PF2e versions where it is a public method)
    if (typeof featTab.filterIndexData === "function") {
        const originalFilterIndexData = featTab.filterIndexData.bind(featTab);
        featTab.filterIndexData = function (entry) {
            const passed = originalFilterIndexData(entry);
            if (!passed) return false;

            const scope = this._pf2eAvrArchetypeScope;
            if (scope) {
                return entryMatchesArchetypeScope(entry, scope);
            }
            return true;
        };
    }

    // 5. Wrap `featTab.getIndexData` (used by PF2e's browser pagination / result list)
    if (typeof featTab.getIndexData === "function") {
        const originalGetIndexData = featTab.getIndexData.bind(featTab);
        featTab.getIndexData = function (...args) {
            const res = originalGetIndexData(...args);
            const scope = this._pf2eAvrArchetypeScope;
            if (scope && Array.isArray(res)) {
                return res.filter(entry => entryMatchesArchetypeScope(entry, scope));
            }
            return res;
        };
    }

    // 6. Wrap `featTab.resetFilters` so clicking "Clear All Filters" clears our archetype scope
    if (typeof featTab.resetFilters === "function") {
        const originalResetFilters = featTab.resetFilters.bind(featTab);
        featTab.resetFilters = function (...args) {
            clearArchetypeScope(this);
            return originalResetFilters(...args);
        };
    }

    // Capture original open functions so Clear button can trigger a clean re-render without recursion
    const originalTabOpen = typeof featTab.open === "function" ? featTab.open.bind(featTab) : null;
    const originalBrowserOpenTab = typeof browser.openTab === "function" ? browser.openTab.bind(browser) : null;

    const reopenFeatTabClean = async (freshFilter) => {
        if (originalTabOpen) {
            return originalTabOpen(freshFilter);
        }
        if (originalBrowserOpenTab) {
            return originalBrowserOpenTab("feat", freshFilter);
        }
    };

    let handlingOpen = false;

    const runEnhancedFeatOpen = async (invokeOriginal, args) => {
        if (handlingOpen) {
            return invokeOriginal(...args);
        }

        const ctx = consumePendingBrowseContext();
        if (!ctx) {
            // Normal Compendium Browser open (not from a Feats-tab Browse button):
            // always clear any leftover archetype prerequisite scope so it never leaks.
            clearArchetypeScope(featTab);
            return invokeOriginal(...args);
        }

        handlingOpen = true;
        try {
            const patchSpec = await buildBrowsePatchSpec(ctx);
            if (!patchSpec) {
                clearArchetypeScope(featTab);
                return await invokeOriginal(...args);
            }

            if (patchSpec.archetypeScope) {
                // Restore full array first so re-scoping starts from the complete dataset
                restoreIndexDataScope(featTab);
                featTab._pf2eAvrArchetypeScope = patchSpec.archetypeScope;
                applyIndexDataScope(featTab);
            } else {
                clearArchetypeScope(featTab);
            }

            // Look for PF2e's live filter argument (e.g., args[0] in `featTab.open(filter)` or args[1] in `openTab("feat", filter)`)
            const filterArg = extractFilterFromArg(args[0]) || extractFilterFromArg(args[1]);
            const hadFullFilter = Boolean(filterArg && (filterArg.multiselects || filterArg.checkboxes));
            if (filterArg) {
                applyPatchToFilterObject(filterArg, patchSpec);
            }

            const result = await invokeOriginal(...args);

            // If indexData loaded during open() and wasn't scoped yet, scope and trigger a clean refresh
            if (patchSpec.archetypeScope && !featTab._pf2eAvrIndexDataIsGetter && Array.isArray(featTab.indexData)) {
                const beforeLen = featTab.indexData.length;
                applyIndexDataScope(featTab);
                if (featTab.indexData.length !== beforeLen) {
                    const refreshedFilter = featTab.filterData ? foundry.utils.deepClone(featTab.filterData) : filterArg;
                    if (refreshedFilter) {
                        await reopenFeatTabClean(refreshedFilter);
                    }
                }
            }

            // If PF2e created/cloned its filterData inside `open()` instead of reusing our mutated object,
            // apply the patch to live `featTab.filterData` and refresh once if needed.
            if (featTab.filterData && (!hadFullFilter || featTab.filterData !== filterArg)) {
                applyPatchToFilterObject(featTab.filterData, patchSpec);
                if (!hadFullFilter) {
                    try {
                        browser?.render?.({ force: false });
                    } catch { /* ignore */ }
                }
            }

            // Render the dismissible Archetype Filter banner if active (next tick so Svelte DOM mounts first)
            setTimeout(() => syncArchetypeScopeBanner(featTab, reopenFeatTabClean), 60);

            return result;
        } finally {
            handlingOpen = false;
        }
    };

    // 7. Wrap `featTab.open`
    if (originalTabOpen) {
        featTab.open = async function (...args) {
            return runEnhancedFeatOpen(originalTabOpen, args);
        };
    }

    // 8. Wrap `browser.openTab`
    if (originalBrowserOpenTab) {
        browser.openTab = async function (tabName, ...rest) {
            if (tabName !== "feat") {
                clearArchetypeScope(featTab);
                return originalBrowserOpenTab(tabName, ...rest);
            }
            return runEnhancedFeatOpen(
                (...allArgs) => originalBrowserOpenTab(...allArgs),
                [tabName, ...rest]
            );
        };
    }

    // 9. Re-sync banner on re-render and restore full indexData on browser close
    Hooks.on("renderCompendiumBrowser", () => {
        if (featTab._pf2eAvrArchetypeScope) {
            setTimeout(() => syncArchetypeScopeBanner(featTab, reopenFeatTabClean), 40);
        }
    });

    Hooks.on("closeCompendiumBrowser", () => {
        clearArchetypeScope(featTab);
    });

    browserWrapped = true;
}

/* ------------------------------------------------------------------------- */
/* 7. INITIALIZATION                                                         */
/* ------------------------------------------------------------------------- */

export function initSmartFeatBrowser() {
    registerFeatsTabContextCapture();
    wrapCompendiumBrowser();
    console.log("PF2e Awesome Variant Rules | Smart Feat Browser Initialized.");
}
