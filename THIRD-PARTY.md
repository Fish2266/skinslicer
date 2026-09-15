# Third-party material

## Code

None vendored. Everything under `js/` is this project's, or copied from its
siblings [Frame & Groove](https://github.com/Fish2266/frame-and-groove) and
[All The Sounds](https://github.com/Fish2266/all-the-sounds) under the same
MIT licence (see the layout table in the README for which files).

## Derived from Minecraft

**No Mojang textures, skins, capes or audio ship with this app.** What is
derived from the game is numbers and facts, not art:

| What | Where | Used for |
| --- | --- | --- |
| The player model's boxes, pivots and inflation | `js/model/models.js` | drawing the player the way the game does |
| The box UV unwrap (`ModelPart.Cube`) | `js/model/uv.js` | putting each skin pixel on the right face |
| The skin sheet layout, both layers, both arm widths | `js/skin/layout.js` | items, painting, mirroring |
| The legacy 64×32 conversion and the base-layer alpha rule | `js/skin/image.js` | reading old skins the way the game reads them |
| The sixteen dye colours | `js/skin/color.js` | a familiar palette for tinting |

Every preset item, the Fish cape, the mannequin skin, the pixel mark and the
icons are this project's own — drawn in code, or drawn by hand into
`js/ui/pixelart-overrides.js` and `js/skin/items-overrides.js`.

## Mojang's capes, fetched at runtime

The Capes shelf lists every official Java Edition cape by its texture id
(`js/skin/capes.js`). The ids come from the [Minecraft Wiki](https://minecraft.wiki/w/Cape)
and [Craftdex](https://craftdex.net/capes), and each was checked against
`textures.minecraft.net`. The textures themselves are Mojang's: they are
fetched from Mojang's texture host when the app first opens and cached in your
browser, and are not part of this repository.

## Services used at runtime

When you type a player's name, and — for the official capes — the first time
the app opens:

| Service | Why |
| --- | --- |
| `playerdb.co` | Mojang's profile API sends no CORS headers, so a web page cannot read it; this public mirror can be read. Receives the name you typed. |
| `api.ashcon.app` | The fallback when playerdb.co does not answer. Receives the name you typed. |
| `textures.minecraft.net` | Mojang's texture host, for the skin and cape PNGs themselves, and for the official capes on the Capes shelf. Receives only texture ids. |

A skin or cape fetched this way belongs to the player who made or was given
it. The app stores it in your browser only.

Not an official Minecraft product. Not approved by or associated with Mojang
or Microsoft.
