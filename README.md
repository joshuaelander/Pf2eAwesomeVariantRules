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
8. Improved Wounded Recovery (Requires Pf2eImprovedHeroPoints)
9. Half Price Consumables (TBD)
10. Spell Runes (TBD)
11. Risk Dice / Tension Dice (Done)
12. Sanity Dice (TBD)
13. Spellcasting Modifiers (TBD)

### Risk Dice (Tension Dice Variant)
A dynamic tension pool mechanic for Pathfinder 2e exploration and danger:
- **Core Loop**: Every time the party takes time in a dangerous area, makes loud noise, forces locks, or loots recklessly, the Risk Dice pool increases by 1 die and is secretly rolled (Nd6).
- **Complications**: If **any** die in the roll turns up a **1**, a complication occurs (tension snaps) and the pool automatically resets to 0! If no 1s are rolled, the party is safe for now and the pool holds at N dice (so the next risk will roll (N+1)d6).
- **Player & GM Flow**:
  - Players (or GM) can click the **Take a Risk** macro button (or hold Shift to describe what they are doing).
  - A public suspense card announces the current pool size and that a secret roll was made.
  - The roll result is sent as a **Blind GM Roll** to the Game Master, with all complication 1s highlighted with red glowing badges.
  - The GM card includes an **Announce Complication to Players** button to reveal the consequences at the right narrative beat.
- **GM Visibility**:
  - **On-Screen HUD**: A draggable widget displaying the current count with quick-action buttons (`+1 & Roll`, `Roll Pool`, `Reset`, `Manager Dialog`).
  - **Scene Controls**: A tool button in the Token Layer toolbar showing the live count.
  - **Risk Dice Manager Dialog**: Accessible via macro or HUD to manually adjust, add, or roll dice at will.
- **Complication Roll Table (Optional)**:
  - When a complication occurs, GMs (or players) can roll on a d20 complication table to determine what consequence strikes the party.
  - Can be triggered directly from the **GM Secret Risk Card**, via the **Roll Complication** macro, or inside the **Risk Dice Manager**.
  - Fully customizable ranges in module settings (e.g. `1-10: Hostile Patrol`, `11-15: Environmental Hazard`, `16-20: Party sustains an injury`).
  - Supports linking directly to an existing Foundry World RollTable by name/UUID.
  - Results are whispered secretly to the GM by default (with a one-click button to reveal to players), or can be set to public in settings.
- **Configurable Settings**:
  - Enable/disable the variant rule.
  - Custom die face (d6 default, d4, d8, d10, d12, d20).
  - Custom complication target number (default 1).
  - Public chat announcement toggle.
  - Show/hide floating HUD widget.
  - Player dice count visibility toggle.
  - Enable/disable Complication Roll Table.
  - Complication die formula (default `1d20`).
  - Complication table ranges and descriptions.
  - Optional Foundry RollTable link.
  - Show complication results to players toggle.

If you'd like you can help support me over on Patreon to see this and many other fun tools, maps, etc related to PF2e. Linked here: https://patreon.com/AeneasPF2e

Author: Aeneas (Joshua Elander)

Disclaimer: All code here is the work of and belongs to the author. I hereby give you permission to use it by importing it into foundry vtt and using it with PF2e. However, if you wish to fork or use this code in your own code, please request permission to use this code first. The user acknowledge that all work here is on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
