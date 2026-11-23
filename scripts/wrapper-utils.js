/**
 * PF2e Awesome Variant Rules: Unified libWrapper-Compatible Wrapping Utility
 *
 * Allows multiple features within this module to cleanly wrap the same Foundry / PF2e
 * method while registering at most ONE `"WRAPPER"` per target with `libWrapper` (when
 * the `lib-wrapper` module is installed and active).
 *
 * Benefits:
 * - Zero `libWrapper` conflict warnings alongside modules like PF2e Toolbelt,
 *   PF2e Exploit Vulnerability, PF2e Feat Filter, etc.
 * - Zero hard dependency on `lib-wrapper`: falls back cleanly to safe prototype/method
 *   chaining if `lib-wrapper` is not installed.
 * - Preserves synchronous execution for sync methods (like `prepareDerivedData`) and
 *   Promise return values for async methods (like `compendiumBrowser.openTab`).
 */

const MODULE_ID = "pf2e-awesome-variant-rules";

/**
 * Registry of all wrapped target paths owned by this module:
 * Map<targetPath, { handlers: Function[], installed: boolean }>
 */
const wrapperRegistry = new Map();

/**
 * Check whether the `lib-wrapper` module is installed and active.
 * @returns {boolean}
 */
export function isLibWrapperActive() {
    return Boolean(
        globalThis.libWrapper
        && typeof globalThis.libWrapper.register === "function"
        && game?.modules?.get?.("lib-wrapper")?.active
    );
}

/**
 * Resolve a dot-separated global path (e.g. `"CONFIG.PF2E.Actor.documentClasses.character.prototype.prepareDerivedData"`)
 * into `{ parent, key, isGetter }`. Supports libWrapper's `#get` suffix for property getters.
 *
 * @param {string} targetPath
 * @returns {{ parent: object, key: string, isGetter: boolean }|null}
 */
function resolveTargetPath(targetPath) {
    if (!targetPath || typeof targetPath !== "string") return null;

    let cleanPath = targetPath;
    let isGetter = false;
    if (cleanPath.endsWith("#get")) {
        cleanPath = cleanPath.slice(0, -4);
        isGetter = true;
    }

    const parts = cleanPath.split(".");
    const key = parts.pop();
    if (!key) return null;

    let parent = globalThis;
    for (const part of parts) {
        if (parent == null) return null;
        parent = parent[part];
    }
    if (parent == null || (typeof parent !== "object" && typeof parent !== "function")) {
        return null;
    }

    return { parent, key, isGetter };
}

/**
 * Walk the prototype chain to locate a property descriptor.
 */
function findDescriptor(obj, key) {
    let cur = obj;
    while (cur && cur !== Object.prototype) {
        const desc = Object.getOwnPropertyDescriptor(cur, key);
        if (desc) return desc;
        cur = Object.getPrototypeOf(cur);
    }
    return null;
}

/**
 * Register a `"WRAPPER"` handler for a global target path (method or `#get` getter).
 * Multiple features in this module can safely register handlers on the same `targetPath`;
 * they are chained in registration order under a single `libWrapper.register(...)` call.
 *
 * Handler signature: `function (wrapped, ...args) { ... return wrapped.apply(this, args); }`
 *
 * @param {string} targetPath - Global dot-path (e.g. `"CONFIG.PF2E.Actor.documentClasses.character.prototype.prepareDerivedData"`)
 * @param {Function} handler - Wrapper function `(wrapped, ...args) => result`
 * @param {"WRAPPER"|"MIXED"|"OVERRIDE"} [type="WRAPPER"]
 * @returns {boolean} True if registration succeeded
 */
export function registerWrapper(targetPath, handler, type = "WRAPPER") {
    if (!targetPath || typeof handler !== "function") return false;

    let entry = wrapperRegistry.get(targetPath);
    if (entry) {
        if (!entry.handlers.includes(handler)) {
            entry.handlers.push(handler);
        }
        return entry.installed;
    }

    const resolved = resolveTargetPath(targetPath);
    if (!resolved) return false;

    const { parent, key, isGetter } = resolved;
    if (isGetter) {
        const desc = findDescriptor(parent, key);
        if (!desc?.get) return false;
    } else if (typeof parent[key] !== "function") {
        return false;
    }

    entry = { handlers: [handler], installed: false };
    wrapperRegistry.set(targetPath, entry);

    // Dispatcher chains all handlers registered by this module for `targetPath`
    // while keeping sync methods strictly synchronous and async methods async.
    const dispatcher = function (wrapped, ...args) {
        const receiver = this;
        let chain = (...callArgs) => wrapped.apply(receiver, callArgs);
        for (const fn of entry.handlers) {
            const next = chain;
            chain = (...callArgs) => fn.call(receiver, next, ...callArgs);
        }
        return chain(...args);
    };

    // 1. Prefer libWrapper when active to prevent conflicts with PF2e Toolbelt, Exploit Vulnerability, etc.
    if (isLibWrapperActive()) {
        try {
            globalThis.libWrapper.register(MODULE_ID, targetPath, dispatcher, type);
            entry.installed = true;
            return true;
        } catch (err) {
            console.warn(`PF2e Awesome Variant Rules | libWrapper registration failed for "${targetPath}", falling back to safe manual wrap:`, err);
        }
    }

    // 2. Fallback when lib-wrapper is not installed (or target couldn't be registered by libWrapper)
    try {
        if (isGetter) {
            const desc = findDescriptor(parent, key);
            if (!desc?.get || !desc.configurable) return false;
            const origGet = desc.get;
            const origSet = desc.set;
            Object.defineProperty(parent, key, {
                configurable: true,
                enumerable: desc.enumerable ?? true,
                get() {
                    return dispatcher.call(this, origGet);
                },
                ...(origSet ? { set(val) { origSet.call(this, val); } } : {})
            });
        } else {
            const original = parent[key];
            parent[key] = function (...args) {
                return dispatcher.call(this, original, ...args);
            };
        }
        entry.installed = true;
        return true;
    } catch (err) {
        console.error(`PF2e Awesome Variant Rules | Failed to wrap "${targetPath}":`, err);
        return false;
    }
}
