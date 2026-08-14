# reference/

Nothing in here is part of the site. It is not served, not cached by `sw.js`,
and not referenced by any game. It is working material that happens to live
next to the code it is about.

## `kling-superhero-character-sheet.xlsx`

A prompt kit for Kling AI: superhero character sheets for the arcade's two
characters, plus the prompts that turn them into reference images and then into
video clips. Six tabs — Read Me, Character Sheet, Prompt Builder, Shot List,
Modifiers, Negative Prompts.

The point of it is continuity. The Character Sheet holds one column per hero:
every costume, face and effect detail that has to stay identical between shots.
The Prompt Builder resolves the hero picked in its drop-down against that sheet
and concatenates the fields into finished prompt strings, so a costume change is
made in one cell and every prompt downstream updates. Yellow cells are inputs;
everything else is a formula.

## `build-kling-sheet.py`

Regenerates the workbook from scratch:

```bash
pip install openpyxl
OUT=kling-superhero-character-sheet.xlsx python3 build-kling-sheet.py
```

Editing the spreadsheet by hand is fine and expected — that is what it is for.
Come back to the script only when the *structure* needs changing (a new field on
every hero, another prompt recipe, more shot rows), since hand-editing those
means repeating yourself across three tabs.

Formulas are written for LibreOffice compatibility: `INDEX`/`MATCH` rather than
`XLOOKUP`, and `TEXTJOIN` carries the `_xlfn.` prefix openpyxl needs. Recalculate
after regenerating, or every formula cell reads back empty to anything but Excel.
