# Hex War Move Assistant

Owlbear Rodeo 2 extension prototype for hex-wargame movement.

## Current MVP

- Bind selected token with `A-D-M`, e.g. `14-6-3`
- Store unit JSON in token metadata
- Store terrain movement cost in scene metadata
- Default terrain cost = `1`
- Impassable terrain = `99999`
- Movement cost is paid when entering target hex
- Compute reachable hexes using movement points
- Highlight reachable hexes
- Click highlighted hex to auto-move selected unit
- Mark unit `moved=true`

## Local development

```bash
npm install
npm run dev
```

Then install the extension in Owlbear Rodeo using:

```text
http://localhost:5173/manifest.json
```

## GitHub Pages deployment

1. Push this folder to a GitHub repository.
2. Add a GitHub Pages workflow or build locally with:

```bash
npm run build
```

3. Publish the `dist/` folder.
4. In Owlbear Rodeo, install the extension using:

```text
https://YOUR_NAME.github.io/YOUR_REPO/manifest.json
```

## Notes

The first version assumes the Owlbear scene grid is aligned to the scene origin. If a map has unusual hex offset/alignment, the next step is to add a configurable hex-origin offset.
