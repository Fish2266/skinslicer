# Skin Slicer

A 3D wardrobe for Minecraft skins. Start from a base skin, put things on over
it — hats, tops, bottoms, shoes, any official Java cape — and tint every colour
of every piece on its own. Cut clothes out of anyone's skin, paint your own,
save a few pieces together as a look. Keep as many outfits as you like, swap
between them, and export any of them as the one PNG the game reads. Runs
entirely in the browser — no build step, no account.

The second of [Fish's MC Tools](https://fish2266.github.io/mctools), next to
[Frame & Groove](https://fish2266.github.io/frame-and-groove/) and
[All The Sounds](https://fish2266.github.io/all-the-sounds/), and built from
the same parts.

---

## How to run it locally

```bash
python3 .devserver.py
```

Then open <http://127.0.0.1:8741>. It has to be served over `http://` rather
than opened as a `file://` path, because the app is ES modules.

---

## The thing worth knowing first

**An outfit is a base plus what is worn over it.** The base is a whole skin —
yours, fetched by name, a PNG, or the plain mannequin. Items are drawn over it
in order, later ones on top. Bases are shared: paint one and every outfit built
on it changes too. That is the point of a base layer — your face and hands stay
yours whatever you are wearing.

**Everything is a skin in the end.** The game reads one 64×64 PNG, so every
item lives on the skin sheet: the base layer, or the outer layer that sits half
a pixel proud of it. Nothing can stick out further than that — a cap has a brim
drawn on, not a brim — because the result has to be a skin the game will load.

**Tinting is by colour group, not by item.** A red-and-green hat is two
groups; tint it blue-and-yellow and the red becomes blue, the green yellow, and
neither bleeds into the other. Each pixel keeps its offset from its group's
colour in OKLab, so shading survives the tint: lighter stays lighter, a
hue-shifted shadow stays hue-shifted, and a yellow does not go muddy the way it
would in HSV.

- **Preset items** are drawn in code in named groups (`js/skin/items.js`), so
  their groups are exact — the beanie's knit, fold and pom are three groups
  because they were drawn as three.
- **Your own items and capes** — cut from any skin, or pulled from a player —
  are split into groups by clustering their colours (`js/skin/tint.js`). The
  split is mostly hue, weighted by how colourful the pixels are, so every shade
  of one colour lands together while black and white stay apart. A slider per
  item nudges it toward fewer or more groups.
- **Match to the cape** gives every item the cape's colours — each item's
  biggest colour takes the cape's biggest, its second the cape's second — which
  is the landing page's "tint outfits to match capes".
- **Match to the skin** does the same with the base skin's own colours — its
  hair, its clothes, its eyes — leaving out its skin tone (the commonest colour
  on the lower half of the face), because clothes matched to that just come
  out as more skin.
- **The pipette** on every colour row, and in the swatch popover, takes a
  colour straight off the model: the next click on the stage reads the pixel
  under it from the outfit as shown, cape included. Chromium browsers also get
  the system eyedropper, for a colour from anywhere on the screen.

Tints are keyed by group number, so the groups have to hold still. Once an
item's colours are grouped, each pixel remembers its group, and the group its
name and reference colour (`layerFromGroups` in `js/skin/tint.js`). Painting
only regroups the pixels that changed colour — joining a group they are close
to, or starting a new one — so a tint never jumps to another colour, and a
fresh colour painted over a tinted one shows as drawn. A preset turned into
your own copy keeps the preset's exact groups, and the pieces of a split item
keep the whole's, so their tints carry over as they are. Only the colour-group
slider starts the grouping again from scratch.

**Hide what is under it.** An item drawn on the base layer can clear the base
skin's own outer layer over the same pixels, so a jacket painted into your old
skin's sleeves does not show through a new shirt. It only ever clears the
base's outer layer, never another item, and it is a switch per item.

## Looking a player up

Type a name and the app fetches that player's skin (with the right arm model)
and cape. Mojang's own profile API sends no CORS headers, so a web page cannot
read it; the name goes to **playerdb.co**, or **api.ashcon.app** if that does
not answer, and the textures themselves come from Mojang's
`textures.minecraft.net`. In testing, ashcon returned a stale skin for one
account where playerdb had the live one, which is why playerdb goes first.

The name you type is the only thing that ever leaves the browser.

A fetched skin becomes a base and a fetched cape joins your capes. A base
fetched this way remembers whose it was, and can be refreshed from their
account later (which replaces anything you painted on it — it asks first).

## Capes

The Capes shelf has every official Java Edition cape — the ones given to
everyone (Migrator, Vanilla, Pan, Common), the event capes, the five MINECONs,
Mojang's staff capes, the community ones (Translator, Mojira Moderator, Realms
Mapmaker, Scrolls, Cobalt) and the one-of-a-kind personal ones — grouped as the
Minecraft Wiki groups them. They are listed by texture id in `js/skin/capes.js`
and fetched from Mojang's `textures.minecraft.net` the first time the app
opens, then kept in the browser's cache store; none of them ship in this
repository. Every id was checked to answer with a 64×32 PNG, and every texture
was checked by eye against its name.

The game only shows a cape Mojang gave the account, so wearing one here is for
the look, for mods that read cape files, and for matching the outfit to it.
The one cape that is not real is the Fish, which stays.

**Pick the capes you own** at the top of the Capes shelf (or right-click any
official cape) and those go to the front, under Yours, tagged Owned. Mojang
will not say which capes an account has without signing in, so the list is
yours to keep; it lives in this browser.

## Making items from a skin

Any skin — a player's by name, a PNG, or one of your bases — can be cut into
items (`js/skin/split.js`):

1. **Keep** the parts that are clothes, per body part and layer — everything
   but the head, both layers, to start with.
2. **Erase** what is not: the wand (everything touching the clicked pixel in
   that colour, flooded round the part's four sides, so a hand is one click),
   **Skin** (click a hand and every shade of that skin goes, lit or shadowed —
   matched loosely on lightness and tightly on hue, so grey and white clothes
   are safe), a colour everywhere, a brush eraser and a restore brush. Every
   tool shows what a click will take before you click: hover the model and
   those pixels turn pink, with a count. Parts can be hidden — each limb, the
   body, the head, the outer layer — to reach what is behind them, and the
   tools leave hidden parts alone. A click on a see-through outer-layer pixel
   goes to the base-layer pixel you can see under it. Mirror, undo, and Start
   over.
3. Keep it as **one item**, or **split it into pieces**: the head is the hat,
   the body and arms the top, the legs the bottoms, and the last few rows of
   the legs the shoes — guessed from where the trouser colour stops, and
   adjustable. Each piece is its own item on its own shelf, tinted on its own.

Splitting also saves the pieces together as a **look**. The Looks shelf holds
those: one click puts every piece on, in the colours it was saved in; click
again to take them off. Save what an outfit is wearing as a look from the
Wearing panel. Any item of your own can be split later, too, and its pieces
replace it on every outfit wearing it.

## Painting

The Paint view paints on the model itself. The stage is Frame & Groove's WebGL
viewer, copied unchanged: nearest filtering so a pixel is a pixel, and a
picking pass whose colour *is* the texel coordinate, so one `readPixels` turns
a click into the exact pixel under it whichever way the model is turned. The
flat 64×64 sheet beside it takes strokes too.

**Painting on** picks what the brush changes: the base, or any one thing the
outfit is wearing — so you can paint over the clothes, or paint the clothes
themselves. Everything else stays on show while you paint, unless you hide it
there. A preset turns into your own copy the moment you pick it (presets are
drawn by the app, so they stay as they are), with its tints carried over.
**New item** starts an empty, see-through sheet worn on top; paint it and it
is an item like any other, on whichever shelf you gave it. Any item can be
opened in Paint from the Dress inspector or by right-clicking it on a shelf.

Brush, eraser, line and rectangle (outline or filled, within one face), fill
(within one face), replace a colour everywhere, eyedropper, shade, dither,
noise, a brush size of 1–3 pixels, and a mirror that paints left and right
together. **Body parts** can be hidden — each limb, the body, the head — to
reach what is behind them; hidden parts cannot be painted, on the model or
the sheet. A base's base layer has no eraser — the game
draws it opaque — but items can be erased anywhere: they only cover what they
paint. Undo is per base and per item.

## Hand-drawn art

The icons and the preset wardrobe are drawn in code, and each has an escape
hatch for art drawn by hand: `js/ui/pixelart-overrides.js` for the mark, the
rail and the shelf icons, and `js/skin/items-overrides.js` for wardrobe
items — a preset redrawn, renamed, moved to another shelf or left out, or a
new item with no code at all. An entry there wins; anything without one is
drawn in code as before. A hand-drawn item carries its colour groups, so it
tints exactly as a drawn one does.

Both files are written by a private studio in `tools/`
(`http://127.0.0.1:8741/tools/icon-studio.html` with the dev server running)
which, like Frame & Groove's icon studio, is ignored by git — so it is not
part of the repository or the published site.

## One thing that differs from Frame & Groove

`render3d.js` is a straight copy, but `js/model/uv.js` is not. The UV unwrap
here is written from vanilla's `ModelPart.Cube` vertex table: the cross
texture's leftmost face goes on **−X**, the entity's right side, and each face's
texture runs left-to-right as seen from outside. A skin is the one texture
where a mirrored face shows immediately — writing on a shirt reads backwards —
so this was checked against a real texture with lettering on it: a MineCon
2015 cape, whose "15" reads the right way round on the model's back.

## Arm width

Slim ("Alex") arms are three pixels wide. Every preset item is drawn per arm
width, so a slim sleeve is drawn for a slim arm rather than a classic sleeve
with a column sliced off. The width is a property of the base, guessed from the
PNG on import (a slim skin leaves two columns of the sheet empty) and
switchable in the Dress inspector.

## What lands in the zip

Export → "Download the whole wardrobe":

```
skin-slicer.zip
├── skins/<outfit>.png            every outfit, ready to upload
├── capes/<outfit>_cape.png
└── wardrobe/
    ├── wardrobe.json             outfits, looks, and what the PNGs below are
    ├── bases/<id>.png
    ├── items/<id>.png
    └── capes/<id>.png
```

Drop it back on the Outfits page and everything comes back. Ids are kept, so
importing the same backup twice replaces rather than duplicates.

## Keyboard

| Key | Does |
| --- | --- |
| `⌘K` | Command palette — every item, cape and outfit by name |
| `[` `]` | Previous / next outfit |
| `T` | Turntable (Dress) |
| `O` | Outer layer on/off (Dress) · base/outer layer (Paint) |
| `C` | Cape on/off (Dress) |
| `H` / `Delete` | Hide / take off the selected item (Dress) |
| `Esc` | Stop picking a colour off the model (Dress) |
| `B` `E` `L` `U` `G` `R` `I` `S` `D` `N` | Brush, eraser, line, rectangle, fill, replace colour, eyedropper, shade, dither, noise (Paint) |
| `[` `]` | Brush size (Paint) |
| `W` `S` `C` `E` `R` | Wand, skin, colour, eraser, restore (the item maker) |
| `M` | Mirror (Paint) |
| `⌘Z` / `⇧⌘Z` | Undo / redo (Paint) |

## Layout

```
index.html
css/      tokens · base · components · app   byte-for-byte copies from All The Sounds
                                               (which copies them from Frame & Groove)
          wardrobe                             only this app's own layer, plus Frame &
                                               Groove's tool dock and stage chrome
js/
  core/   dom util icons texturepack          copied from All The Sounds
          db store                            this app's own, on the same pattern
  audio/  engine                              a stand-in with only the AudioContext,
                                              so ui/sfx.js is a straight copy
  model/  render3d                            copied from Frame & Groove
          uv                                  vanilla's unwrap (see above)
          models                              the player model + F&G's flattenModel
  skin/   layout                              where every face lives on the sheet
          color tint                          OKLab, colour groups, recolouring
          items starter                       the preset wardrobe and the mannequin
          items-overrides                     hand-drawn items, written by the local studio
          capes                               every official cape by texture id, and the Fish
          split                               erasing by colour, cutting items into pieces
          image compose outfit                reading, flattening, the document
          mojang                              the name lookup
  export/ zip                                 copied from All The Sounds
          backup                              the wardrobe zip
  ui/     kit sfx tooltip cmdk textures        copied from All The Sounds
          pixicons pixelart-overrides
          shell brandmark wardicons stage
          thumbs tintui sources
  ui/views/ outfits dress paint export
```

When Frame & Groove's design language or one of the shared modules changes,
copy it across again rather than editing it here.

The database is called `skin-slicer`: the three tools are served from one
origin on GitHub Pages, so they would otherwise open each other's data.

## Storage

Outfits, bases, items, capes and looks live in IndexedDB in your browser, as
raw pixels at the game's own size. The official capes are cached there too,
after the first fetch. Browsers can evict site data under pressure;
the wardrobe zip is the real backup.

## Putting it online

Static files, no build step, so GitHub Pages serves it as-is from a repository
called `skinslicer` at `https://fish2266.github.io/skinslicer/`:
Settings → Pages → Deploy from a branch, `main`, `/ (root)`. `.nojekyll` is
there and every path is relative.

## Licence and legal

- **[LICENSE](LICENSE)** — MIT, as Frame & Groove.
- **[THIRD-PARTY.md](THIRD-PARTY.md)** — what is derived from Minecraft
  (numbers, not art), the Mojang textures fetched at runtime, and the
  services a name lookup talks to.
- **Privacy.** No accounts, no analytics, no cookies, no servers of its own.
  Only a name you type to look up leaves the browser. The official capes are
  fetched from Mojang by their texture ids, which are the same for everyone.

> NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH
> MOJANG OR MICROSOFT.
