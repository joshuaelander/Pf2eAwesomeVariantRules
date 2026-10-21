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

If you'd like you can help support me over on Patreon to see this and many other fun tools, maps, etc related to PF2e. Linked here: https://patreon.com/AeneasPF2e

Author: Aeneas (Joshua Elander)

Disclaimer: All code here is the work of and belongs to the author. I hereby give you permission to use it by importing it into foundry vtt and using it with PF2e. However, if you wish to fork or use this code in your own code, please request permission to use this code first. The user acknowledge that all work here is on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
