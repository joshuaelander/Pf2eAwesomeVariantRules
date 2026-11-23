# Pf2e Awesome Variant Rules
Overview: A collection of tweaks and house rules that my tables have found fun when playing PF2e. 

Contents: 
1. Added Extra General Feats (Done)
2. Added Extra Skill Feats (Done)
3. Enhanced Recall Knowledge (Requires PF2eAwesomeMacrosForPlayers)
4. Improved Crafting (Done)
5. Improved Learn-a-Spell (Done)
6. Split Dice Variant - Alternate Spell Damage / Healing Calculation (Done)
7. Improved Hero Points (Requires Pf2eImprovedHeroPoints)
8. Improved Wounded Recovery (Requires Pf2eImprovedHeroPoints, uses injury roll check)
9. Half Price Consumables (TBD)
10. Spell Runes (TBD)
11. Risk Dice / Tension Dice (Done)
12. Sanity Dice (TBD)
13. Spellcasting Modifiers (Done)
14. Dual Class Variant Rule (Done)
15. Ancestry Paragon Variant Rule (Done)
16. Smart Feat Compendium Browser Enhancements (Done)

### Risk Dice (Tension Dice Variant)
A dynamic tension pool mechanic for Pathfinder 2e exploration and danger:
- **Core Loop**: Every time the party takes time in a dangerous area, makes loud noise, forces locks, or loots recklessly, the Risk Dice pool increases by 1 die and is secretly rolled (Nd6).
- **Complications**: If **any** die in the roll turns up a **1**, a complication occurs (tension snaps) and the pool automatically resets to 0! If no 1s are rolled, the party is safe for now and the pool holds at N dice (so the next risk will roll (N+1)d6).
- **Player & GM Flow**:
  - Players (or GM) can click the **Take a Risk** macro button or the on-screen HUD button (hold Shift to specify an activity description).
  - Synchronized across the network via native Foundry sockets directly to the active Game Master.
  - If **Players Can See Dice Roll** is enabled in settings, the full roll card and outcome banner are displayed publicly to all players.
  - If rolls are kept secret to the GM, a suspense card announces that a risk was taken, while the roll result is sent as a **Blind GM Roll** to the Game Master with glowing complication dice badges and an **Announce Complication to Players** button.
- **HUD & Toolbar Visibility**:
  - **On-Screen Floating HUD**: A draggable widget displaying current Risk Dice with quick-action buttons.
  - **Player Count Privacy**: If "Players Can See Dice Count" is disabled by the GM, the floating HUD remains visible to players for taking risks, but displays `?` instead of the numeric count.
  - **Scene Controls**: A tool button in the Token Layer toolbar showing the live count for the GM.
  - **Risk Dice Manager Dialog**: Accessible via macro, toolbar, or HUD to manually adjust, add, or roll dice at will.
- **Complication Roll Table (Optional)**:
  - When a complication occurs, GMs (or players) can roll on a d20 complication table to determine what consequence strikes the party.
  - Can be triggered directly from the **Risk Card**, via the **Roll Complication** macro, or inside the **Risk Dice Manager**.
  - Fully customizable ranges in module settings with a multiline text area (separated by newlines or semicolons, e.g. `1-10: Hostile Patrol; 11-15: Environmental Hazard; 16-20: Party sustains an injury`).
  - Supports linking directly to an existing Foundry World RollTable by name/UUID.
  - Results can be whispered secretly to the GM by default (with a one-click button to reveal to players), or configured to show publicly.
- **Configurable Settings**:
  - Enable/disable the variant rule.
  - Custom die face (d6 default, d4, d8, d10, d12, d20).
  - Custom complication target number (default 1).
  - **Players Can See Dice Roll**: Toggle whether players see the actual dice rolls and result cards or if they stay secret to the GM.
  - **Players Can See Dice Count**: Allow players to see the numeric count, or hide it with a `?` badge on their HUD and announcements.
  - Public chat announcement toggle.
  - Show/hide floating HUD widget.
  - Enable/disable Complication Roll Table.
  - Complication die formula (default `1d20`).
  - Complication table ranges and descriptions (multiline editor).
  - Optional Foundry RollTable link.
  - Show complication results to players toggle.

### Spellcasting Damage Modifier Variant
A variant rule that empowers spellcasters and kineticists by adding a bonus to damage rolls equal to half their primary spellcasting modifier:
- **Core Mechanic**: Whenever a character rolls damage for a class spell or kineticist impulse, they receive an **untyped bonus** equal to `floor(modifier / 2)` of their primary attribute (e.g. +3 mod \u2192 +1 bonus, +4 mod \u2192 +2 bonus, +6 mod \u2192 +3 bonus).
- **Class Spells Only (Archetype Exclusion)**: Spells gained through Free Archetype or archetype dedications are excluded from this bonus to maintain class identity and prevent archetype power creep.
- **Auto-Detection**:
  - Automatically identifies the character's primary spellcasting class:
    - **Wizard / Witch / Magus**: Intelligence (INT)
    - **Sorcerer / Bard / Oracle / Summoner**: Charisma (CHA)
    - **Cleric / Druid / Animist**: Wisdom (WIS)
    - **Kineticist**: Constitution (CON) for elemental impulses
    - **Psychic**: Chosen subconscious mind key attribute (INT or CHA)
- **Character Sheet Configuration**:
  - In the **Spellcasting** tab (and **Actions** tab for Kineticists), a compact status and control bar is displayed when the setting is enabled.
  - Matches native Pathfinder 2e parchment and crimson-red styling with minimal vertical profile.
  - **Enable/Disable Checkbox**: Easily turn the bonus on or off per character.
  - **Governing Attribute Selector**: Supports `Auto-Detect`, single attributes (`INT`, `WIS`, `CHA`, `CON`), universal mode, and **Dual-Class configurations** (`INT & WIS`, `INT & CHA`, `WIS & CHA`, `CON & INT`, etc.).
  - **Live Damage Indicator**: Displays the current calculated bonus in real time directly on the character sheet.
- **Full Roll Integration**:
  - Seamlessly integrates with native PF2e spell and impulse damage rolls (appears in the breakdown on chat damage cards).
  - Fully compatible with the module's **Split Dice Damage** feature.
- **Configurable Settings**:
  - Enable/disable the variant rule globally in module settings.
  - Toggle inclusion of Kineticist impulses (enabled by default).
  - Restrict to class spells only toggle (enabled by default).

### Dual Class Variant Rule
Full native Pathfinder 2e **Dual-Class PCs** support directly on the character sheet — without cluttering your World Items sidebar with merged custom class items:
- **Off by Default**: Must be explicitly enabled by the GM in Module Settings (`Enable Dual Class Variant Rule`).
- **Second Class Slot on the Character Sheet**:
  - Adds a native-styled **Second Class** field right next to the primary Class field on the Character tab.
  - Pick any class via a built-in searchable **Class Picker Dialog** (showing HP, Key Attribute, initial Saves, and Perception) or simply **drag and drop** any class item directly onto the Second Class slot.
  - Includes one-click view, change, **Resync Features**, and remove controls, plus a hover summary of combined Dual Class stats.
- **Official PF2e Dual-Class Stat Calculation**:
  - **Hit Points**: Automatically uses the **higher** HP per level between both classes (never summed).
  - **Saving Throws, Perception, Weapon/Armor Proficiencies & Spellcasting**: Uses the **highest** proficiency rank from either class at level 1, and higher-level upgrades from both classes' features apply natively via PF2e's Rule Element engine.
  - **Key Attribute Boosts**: Grants the 1st-level key attribute boost from both classes (respecting PF2e's level-1 +4 cap, partial boosts above +4, Apex items, and raw non-stacking when both classes share the same key attribute), with inline selection for multi-option classes and live display inside PF2e's **Attribute Builder**.
  - **Skills**: Automatically trains fixed skills from **both** classes and summarizes the **higher** additional skill allowance in the Second Class tooltip.
  - **Class DCs & Roll Options**: Registers a separate Class DC for the second class using its key attribute and adds `class:<slug>` roll options so feats and predicates recognize both classes.
- **Class Feats & Automatic Level-Up Features**:
  - Adds a dedicated **Dual Class Feats** section on the Feats tab using the second class's exact `classFeatLevels` and pre-filtered Compendium Browser traits.
  - Merges unique extra progression slots (such as Rogue/Investigator every-level Skill Feats) without doubling standard shared progression.
  - **Auto-Grants Class Features on Level Up**: Automatically adds newly unlocked second-class features as you level up (prompting native ChoiceSets for subclasses, schools, bloodlines, etc.), deduplicates shared features (like *Weapon Specialization* or *Shield Block*), and cleans up over-level features if you level down.
- **Configurable Settings**:
  - **Enable Dual Class Variant Rule** (default: `false`).
  - **Auto-Grant Class Features on Level Up** (default: `true`).
  - **Allow Alternative Boost on Shared Key Attribute** (default: `false` — optional house rule if both classes share a single key attribute).

### Ancestry Paragon Variant Rule
Implements Pathfinder 2e's official **Ancestry Paragon** variant rule (*Gamemastery Guide* / *GM Core*):
- **Off by Default**: Must be explicitly enabled by the GM in Module Settings (`Enable Ancestry Paragon Variant Rule`).
- **Official Feat Progression**: Grants an extra Ancestry Feat at **1st level** and an Ancestry Feat at every odd level not already covered by standard progression (**levels 1, 3, 7, 11, 15, and 19** — for **11 total Ancestry Feats** across levels 1–20).
- **Native Sheet Integration**: Adds an **Ancestry Paragon Feats** group right below **Ancestry Feats** on the Feats tab, inheriting the character's exact ancestry and versatile heritage Compendium Browser filters and slot level caps.
- **Non-Destructive & Compatible**: Works standalone or alongside Dual Class and Free Archetype, avoids duplicating groups if another module already provides Ancestry Paragon slots, and preserves existing feats in Bonus Feats if disabled later.

### Smart Feat Compendium Browser Enhancements
Improves PF2e's Feats-tab **Browse** buttons without replacing PF2e's native browser flow:
- **Dual Class Feats** *(automatic when Dual Class is enabled)*: Pre-selects **Class Feat** with the second class trait and **Archetype** (`Any of above`).
- **Ancestry Paragon Feats** *(automatic when Ancestry Paragon is enabled)*: Pre-selects **Ancestry Feat** with the character's ancestry and versatile heritage traits (`Any of above`).
- **Smart Free Archetype Filtering** *(optional setting, off by default)*:
  - Before taking a dedication: filters to **Class Feat** with both **Archetype** and **Dedication** traits.
  - After taking a dedication (on Level 4+ slots or group header Browse): excludes **Dedication** feats, keeps **Archetype**, includes archetype **Class & Skill Feats**, and scopes results to feats in your chosen dedication(s)' prerequisite chain — with a one-click **Clear Archetype Filter** banner inside the browser.
- **Sort Feats by Level Descending** *(optional setting, off by default)*: Automatically sorts Feats-tab Browse results from highest level to lowest.

If you'd like you can help support me over on Patreon to see this and many other fun tools, maps, etc related to PF2e. Linked here: https://patreon.com/AeneasPF2e

Author: Aeneas (Joshua Elander)

Disclaimer: All code here is the work of and belongs to the author. I hereby give you permission to use it by importing it into foundry vtt and using it with PF2e. However, if you wish to fork or use this code in your own code, please request permission to use this code first. The user acknowledge that all work here is on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
