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
 *   - Once a dedication is chosen (Level > 2 slots or header Browse): excludes `Dedication`
 *     (`not: true`) and scopes results to BOTH:
 *       1. All archetype feats in the chosen dedication(s)' transitive prerequisite chain, AND
 *       2. All "Additional Feats" dynamically parsed from PF2e's own Archetypes Journal pages
 *          and the Dedication feat's description (zero hardcoded lists; auto-updates with PF2e!).
 *     Includes a one-click "Clear Archetype Filter" banner inside the browser.
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

/**
 * Cached feat index across all Item compendiums & World Items:
 * Map<uuid, { uuid, name, normName, category, traits, prereqs }>
 */
let allFeatsIndexCache = null;

/**
 * Cached Archetypes journal pages loaded lazily from `pf2e.journals` (and any module/world
 * journals whose title mentions "archetype"):
 * Array<{ name, normName, text }>
 */
let archetypeJournalPagesCache = null;

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
        hint: "Improves PF2e's Free Archetype Browse button: includes both Archetype and Dedication traits before choosing a dedication; once you have a dedication, excludes Dedication feats on higher-level slots and filters to feats from your chosen archetype(s) (including Additional Feats from PF2e's Archetypes journal) with a one-click clear button.",
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
/* 2. TRAIT, PREREQUISITE & ARCHETYPE JOURNAL HELPERS                        */
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
 * Extract the source compendium UUID of an embedded item (Foundry v12-v14).
 */
function getItemSourceUuid(item) {
    return item?._stats?.compendiumSource
        ?? item?.flags?.core?.sourceId
        ?? item?.sourceId
        ?? null;
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

    add(actor?.ancestry?.slug);
    for (const t of actor?.ancestry?.system?.traits?.value ?? []) add(t);

    add(actor?.heritage?.slug);
    for (const t of actor?.heritage?.system?.traits?.value ?? []) add(t);

    for (const t of actor?.system?.traits?.value ?? []) add(t);

    const ancestryGroup = actor?.feats?.get?.("ancestry");
    if (Array.isArray(ancestryGroup?.featFilter)) {
        for (const entry of ancestryGroup.featFilter) {
            if (typeof entry !== "string") continue;
            if (entry.startsWith("traits-")) add(entry.slice("traits-".length));
            else if (entry.startsWith("trait-")) add(entry.slice("trait-".length));
        }
    }

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
 * Build (and cache once per session) an index of ALL feat items across Item compendiums & World Items.
 * Uses fast `pack.getIndex` calls (never loading full documents) so we can match both
 * prerequisite chains AND validate `@UUID[...]` Additional Feats from PF2e's Archetypes journal.
 *
 * @returns {Promise<Map<string, { uuid: string, name: string, normName: string, category: string, traits: string[], prereqs: string[] }>>}
 */
async function getAllFeatsIndex() {
    if (allFeatsIndexCache) return allFeatsIndexCache;

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

    const addEntry = (uuid, name, categoryRaw, traitsRaw, prereqsRaw) => {
        if (!uuid) return;
        const traits = Array.isArray(traitsRaw) ? traitsRaw : [];
        const category = String(categoryRaw || "").toLowerCase().trim();
        indexMap.set(uuid, {
            uuid,
            name: String(name || ""),
            normName: normalizeName(name),
            category,
            traits,
            prereqs: extractPrereqs(prereqsRaw)
        });
    };

    // 1. World feat items (homebrew feats / archetypes)
    for (const item of game.items ?? []) {
        if (item.type !== "feat") continue;
        addEntry(item.uuid, item.name, item.system?.category, item.system?.traits?.value, item.system?.prerequisites);
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
                fields: ["type", "name", "system.category", "system.traits.value", "system.prerequisites.value"]
            });
        } catch {
            continue;
        }

        for (const entry of idx) {
            if (entry.type !== "feat") continue;
            const uuid = entry.uuid || `Compendium.${pack.collection}.Item.${entry._id}`;
            addEntry(uuid, entry.name, entry.system?.category, entry.system?.traits?.value, entry.system?.prerequisites);
        }
    }

    allFeatsIndexCache = indexMap;
    return indexMap;
}

/**
 * Lazily load and cache all pages from PF2e's Archetypes journals (both compendium journals
 * like `pf2e.journals` -> "Archetypes" and any world/module journals with "archetype" in the name).
 *
 * @returns {Promise<Array<{ name: string, normName: string, text: string }>>}
 */
async function getArchetypeJournalPages() {
    if (archetypeJournalPagesCache) return archetypeJournalPagesCache;

    const pages = [];
    const seenPageUuids = new Set();

    const collectFromJournal = (journal) => {
        if (!journal?.pages) return;
        for (const page of journal.pages) {
            if (page.uuid && seenPageUuids.has(page.uuid)) continue;
            if (page.uuid) seenPageUuids.add(page.uuid);

            const content = page.text?.content ?? "";
            if (!content) continue;
            pages.push({
                name: String(page.name || ""),
                normName: normalizeName(page.name),
                text: String(content)
            });
        }
    };

    // 1. World journals mentioning "archetype"
    for (const journal of game.journal ?? []) {
        if (String(journal.name || "").toLowerCase().includes("archetype")) {
            collectFromJournal(journal);
        }
    }

    // 2. Compendium journals (e.g., `pf2e.journals` -> "Archetypes", plus any module archetype journals)
    for (const pack of game.packs ?? []) {
        if (pack.documentName !== "JournalEntry") continue;
        let idx;
        try {
            idx = await pack.getIndex({ fields: ["name"] });
        } catch {
            continue;
        }

        for (const entry of idx) {
            const nameLower = String(entry.name || "").toLowerCase();
            if (!nameLower.includes("archetype")) continue;
            try {
                const journalDoc = await pack.getDocument(entry._id);
                if (journalDoc) collectFromJournal(journalDoc);
            } catch { /* ignore */ }
        }
    }

    archetypeJournalPagesCache = pages;
    return pages;
}

/**
 * Extract `@UUID[...]` targets from HTML/text.
 * Specifically extracts links inside an "Additional Feats" block AND any links directly
 * preceded by a PF2e feat level marker (e.g. `<strong>4th</strong> @UUID[...]`).
 *
 * @param {string} htmlText
 * @returns {Array<{ uuid: string, label: string }>}
 */
function extractAdditionalFeatLinksFromHtml(htmlText) {
    if (!htmlText || typeof htmlText !== "string") return [];

    const results = [];
    const seen = new Set();
    const uuidRegex = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;

    const addMatchesFromSlice = (slice) => {
        uuidRegex.lastIndex = 0;
        let m;
        while ((m = uuidRegex.exec(slice)) !== null) {
            const uuid = m[1].trim();
            const label = (m[2] || "").trim();
            if (!uuid || seen.has(uuid)) continue;
            seen.add(uuid);
            results.push({ uuid, label });
        }
    };

    // 1. Look for an explicit "Additional Feats" section (standard PF2e Archetypes journal & dedication format)
    const addFeatsIdx = htmlText.search(/additional\s+feats/i);
    if (addFeatsIdx !== -1) {
        let slice = htmlText.slice(addFeatsIdx);
        // Stop if another top-level heading (`<h1`, `<h2`) appears after the Additional Feats heading itself
        const afterHeading = slice.slice(24);
        const nextMajorHeading = afterHeading.search(/<h[12]\b/i);
        if (nextMajorHeading !== -1) {
            slice = slice.slice(0, 24 + nextMajorHeading);
        }
        addMatchesFromSlice(slice);
    }

    // 2. Also match level-prefixed feat links anywhere on an archetype page
    //    (e.g. `<strong>4th</strong> @UUID[...]` or `4th @UUID[...]` or `; @UUID[...]`)
    const levelLineRegex = /(?:<strong>\s*)?\b(?:1st|2nd|3rd|(?:[4-9]|1\d|20)th)\b(?:\s*<\/strong>)?[^<]*?@UUID\[([^\]]+)\](?:\{([^}]*)\})?/gi;
    let lm;
    while ((lm = levelLineRegex.exec(htmlText)) !== null) {
        const uuid = lm[1].trim();
        const label = (lm[2] || "").trim();
        if (!uuid || seen.has(uuid)) continue;
        seen.add(uuid);
        results.push({ uuid, label });
    }

    return results;
}

/**
 * Find the matching Archetypes journal page(s) for a Dedication feat (e.g., "Bastion Dedication" -> "Bastion").
 *
 * @param {Item} dedicationFeat
 * @param {Array<{ name: string, normName: string, text: string }>} journalPages
 * @returns {Array<{ name: string, normName: string, text: string }>}
 */
function findJournalPagesForDedication(dedicationFeat, journalPages) {
    const fullName = normalizeName(dedicationFeat?.name);
    const baseName = fullName.replace(/\s+dedication$/i, "").trim();
    const sourceUuid = getItemSourceUuid(dedicationFeat);
    const matched = [];

    for (const page of journalPages) {
        if (baseName && page.normName === baseName) {
            matched.push(page);
            continue;
        }
        if (sourceUuid && page.text.includes(sourceUuid)) {
            matched.push(page);
            continue;
        }
        if (fullName && page.text.toLowerCase().includes(`{${fullName}}`)) {
            matched.push(page);
        }
    }

    return matched;
}

/**
 * Compute the complete set of feat UUIDs & names belonging to the actor's chosen dedication(s):
 * 1. Transitive prerequisite chain across all `archetype` feats in compendiums & world.
 * 2. Additional Feats dynamically parsed from PF2e's own Archetypes journal pages AND
 *    the dedication feat's own description (zero hardcoded lists).
 *
 * Also reports whether any matched feats are non-archetype Additional Feats and which feat
 * categories (`class`, `skill`, `general`, etc.) are represented.
 *
 * @param {Actor} actor
 * @param {Item[]} dedications
 * @returns {Promise<{
 *   uuids: Set<string>,
 *   names: Set<string>,
 *   dedicationNames: string[],
 *   hasAdditionalFeats: boolean,
 *   categories: string[]
 * }>}
 */
async function computeArchetypeMatchingFeats(actor, dedications) {
    const [allFeatsIndex, journalPages] = await Promise.all([
        getAllFeatsIndex(),
        getArchetypeJournalPages()
    ]);

    const dedicationNames = dedications.map(d => d.name);
    const dedicationUuids = new Set(
        dedications.flatMap(d => [d.uuid, getItemSourceUuid(d)].filter(Boolean))
    );

    const matchingUuids = new Set();
    const matchingNames = new Set();
    const categoriesSet = new Set(["class"]);
    let hasAdditionalFeats = false;

    const recordMatchedFeat = (entry, isFromAdditional = false) => {
        if (!entry) return;
        if (entry.traits.includes("dedication")) return;
        if (dedicationUuids.has(entry.uuid)) return;

        matchingUuids.add(entry.uuid);
        if (entry.normName) matchingNames.add(entry.normName);
        if (entry.category) categoriesSet.add(entry.category);
        if (isFromAdditional || !entry.traits.includes("archetype")) {
            hasAdditionalFeats = true;
        }
    };

    // Build a quick lookup by normalized name for fallback matching when journal UUIDs differ slightly
    const featsByNormName = new Map();
    for (const entry of allFeatsIndex.values()) {
        if (entry.normName && !featsByNormName.has(entry.normName)) {
            featsByNormName.set(entry.normName, entry);
        }
    }

    // --- Pass 1: Extract "Additional Feats" dynamically from Archetypes journal & dedication descriptions ---
    for (const dedication of dedications) {
        const htmlSources = [];

        // Check dedication feat's own description
        const desc = dedication.system?.description?.value;
        if (typeof desc === "string" && desc.length > 0) {
            htmlSources.push(desc);
        }

        // Check matching page(s) in PF2e's Archetypes journal
        const pages = findJournalPagesForDedication(dedication, journalPages);
        for (const page of pages) {
            htmlSources.push(page.text);
        }

        for (const html of htmlSources) {
            const links = extractAdditionalFeatLinksFromHtml(html);
            for (const link of links) {
                let featEntry = allFeatsIndex.get(link.uuid);
                if (!featEntry && link.label) {
                    featEntry = featsByNormName.get(normalizeName(link.label));
                }
                if (featEntry) {
                    recordMatchedFeat(featEntry, !featEntry.traits.includes("archetype"));
                }
            }
        }
    }

    // --- Pass 2: Transitive prerequisite chain across all `archetype` feats ---
    const knownNames = new Set([
        ...dedicationNames.map(normalizeName),
        ...matchingNames
    ]);
    for (const feat of actor?.itemTypes?.feat ?? []) {
        const traits = feat.system?.traits?.value ?? [];
        if (Array.isArray(traits) && traits.includes("archetype")) {
            knownNames.add(normalizeName(feat.name));
        }
    }

    let changed = true;
    let guard = 0;
    while (changed && guard < 8) {
        changed = false;
        guard++;

        for (const entry of allFeatsIndex.values()) {
            if (matchingUuids.has(entry.uuid)) continue;
            if (!entry.traits.includes("archetype")) continue;
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
                recordMatchedFeat(entry, false);
                if (entry.normName && !knownNames.has(entry.normName)) {
                    knownNames.add(entry.normName);
                    changed = true;
                }
            }
        }
    }

    return {
        uuids: matchingUuids,
        names: matchingNames,
        dedicationNames,
        hasAdditionalFeats,
        categories: Array.from(categoriesSet)
    };
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

    // 3. Free Archetype -> Smart Dedication vs Chosen Archetype Follow-up (+ Additional Feats) Filtering
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

            if (matchResult.uuids.size > 0) {
                spec.categories = matchResult.categories.length > 0 ? matchResult.categories : ["class", "skill"];
                spec.replaceCategories = true;
                // Important: "Additional Feats" (e.g., Quick Shield Block, Shield Warden) are class/skill/general
                // feats that do NOT carry the `archetype` trait. When Additional Feats are present in the
                // scoped dataset, we exclude `dedication` without forcing the `archetype` trait so they show up!
                spec.traits = matchResult.hasAdditionalFeats
                    ? [{ value: "dedication", not: true }]
                    : [
                        { value: "archetype", not: false },
                        { value: "dedication", not: true }
                    ];
                spec.conjunction = "and";
                spec.archetypeScope = {
                    uuids: matchResult.uuids,
                    names: matchResult.names,
                    dedicationNames: matchResult.dedicationNames,
                    hasAdditionalFeats: matchResult.hasAdditionalFeats
                };
            } else {
                // Fallback if no matching feats found: show general non-dedication Archetype feats
                spec.categories = ["class", "skill"];
                spec.replaceCategories = true;
                spec.traits = [
                    { value: "archetype", not: false },
                    { value: "dedication", not: true }
                ];
                spec.conjunction = "and";
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

function extractFilterFromArg(arg) {
    if (!arg || typeof arg !== "object") return null;
    if (arg.multiselects || arg.checkboxes || arg.order || arg.sliders) return arg;
    if (arg.filter && typeof arg.filter === "object") return arg.filter;
    return null;
}

function findPropertyDescriptor(obj, propName) {
    let cur = obj;
    while (cur && cur !== Object.prototype) {
        const desc = Object.getOwnPropertyDescriptor(cur, propName);
        if (desc) return desc;
        cur = Object.getPrototypeOf(cur);
    }
    return null;
}

function applyIndexDataScope(featTab) {
    if (!featTab || featTab._pf2eAvrIndexDataIsGetter) return;
    const scope = featTab._pf2eAvrArchetypeScope;
    if (!scope) return;

    if (!Array.isArray(featTab.indexData) || featTab.indexData.length === 0) return;

    if (!Array.isArray(featTab._pf2eAvrFullIndexData) || featTab.indexData.length > featTab._pf2eAvrFullIndexData.length) {
        featTab._pf2eAvrFullIndexData = featTab.indexData;
    }

    try {
        featTab.indexData = featTab._pf2eAvrFullIndexData.filter(entry => entryMatchesArchetypeScope(entry, scope));
    } catch { /* fallback hooks handle read-only cases */ }
}

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

function syncArchetypeScopeBanner(featTab, reopenFn) {
    const browser = game.pf2e?.compendiumBrowser;
    const rootEl = browser?.element instanceof HTMLElement ? browser.element : browser?.element?.[0];
    if (!rootEl || !rootEl.querySelector) return;

    removeArchetypeScopeBanner(rootEl);

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
    const extraTag = scope.hasAdditionalFeats ? " (incl. Additional Feats)" : "";
    const banner = document.createElement("div");
    banner.className = "pf2e-avr-archetype-scope-banner";
    banner.innerHTML = `
        <span class="scope-text">
            <strong>Archetype Filter:</strong> ${esc(scope.dedicationNames.join(", "))}${extraTag}
        </span>
        <button type="button" class="scope-clear-btn" title="Show all Archetype feats (including Dedications)">
            Clear Archetype Filter
        </button>
    `;

    banner.querySelector(".scope-clear-btn")?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const prevMaxLevel = featTab.filterData?.sliders?.level?.values?.max ?? null;
        const prevDirection = featTab.filterData?.order?.direction ?? (isSortLevelDescEnabled() ? "desc" : "asc");

        clearArchetypeScope(featTab);

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

    if (typeof featTab.resetFilters === "function") {
        const originalResetFilters = featTab.resetFilters.bind(featTab);
        featTab.resetFilters = function (...args) {
            clearArchetypeScope(this);
            return originalResetFilters(...args);
        };
    }

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
                restoreIndexDataScope(featTab);
                featTab._pf2eAvrArchetypeScope = patchSpec.archetypeScope;
                applyIndexDataScope(featTab);
            } else {
                clearArchetypeScope(featTab);
            }

            const filterArg = extractFilterFromArg(args[0]) || extractFilterFromArg(args[1]);
            const hadFullFilter = Boolean(filterArg && (filterArg.multiselects || filterArg.checkboxes));
            if (filterArg) {
                applyPatchToFilterObject(filterArg, patchSpec);
            }

            const result = await invokeOriginal(...args);

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

            if (featTab.filterData && (!hadFullFilter || featTab.filterData !== filterArg)) {
                applyPatchToFilterObject(featTab.filterData, patchSpec);
                if (!hadFullFilter) {
                    try {
                        browser?.render?.({ force: false });
                    } catch { /* ignore */ }
                }
            }

            setTimeout(() => syncArchetypeScopeBanner(featTab, reopenFeatTabClean), 60);

            return result;
        } finally {
            handlingOpen = false;
        }
    };

    if (originalTabOpen) {
        featTab.open = async function (...args) {
            return runEnhancedFeatOpen(originalTabOpen, args);
        };
    }

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
