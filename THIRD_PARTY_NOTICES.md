# Hermes Agent attribution

Little Bot's native compaction flow is adapted from the Hermes Agent Codex app-server approach, reviewed at commit d0288be5b3330d2442e3907185b8e9d0958297bb.

Source: https://github.com/NousResearch/hermes-agent

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# CAD workshop libraries

The optional CAD workshop ships these libraries unmodified in `node_modules`. Their full licence texts are in each package's `LICENSE` file.

| Package | Version | Licence | Copyright |
| --- | --- | --- | --- |
| [replicad](https://github.com/sgenoud/replicad) | 1.1.0 | MIT | Copyright 2023 QuaroTech Sàrl |
| [replicad-opencascadejs](https://github.com/sgenoud/replicad) (OpenCascade compiled to WebAssembly) | 1.1.0 | LGPL-2.1-only | Open CASCADE SAS and contributors |
| [three](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | Copyright © 2010-2026 three.js authors |
| [acorn](https://github.com/acornjs/acorn) | 8.19.0 | MIT | Copyright (C) 2012-2022 by various contributors |
| [opentype.js](https://github.com/opentypejs/opentype.js) (a replicad dependency) | 1.3.4 | MIT | Copyright (c) 2020 Frederik De Bleser |
| [flatbush](https://github.com/mourner/flatbush) (a replicad dependency) | 4.6.2 | ISC | Copyright (c) 2022, Vladimir Agafonkin |

OpenCascade is used under the GNU Lesser General Public License 2.1. It is loaded at run time as a separate file, `node_modules/replicad-opencascadejs/dist/replicad_single.wasm` with its loader `replicad_single.js`, which can be replaced with a compatible build; the source is available from the replicad and Open CASCADE projects.

# Draughts board assets

The optional draughts board uses these files, all released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain; no credit required, given here with thanks). The textures were scaled down; the sounds are unchanged and renamed. They are in `src/renderer/assets/draughts`.

| File | Source | Author |
| --- | --- | --- |
| maple.jpg | [White Maple Veneer](https://polyhaven.com/a/white_maple_veneer), Poly Haven | Jenelle van Heerden |
| dark-wood.jpg | [Dark Wood](https://polyhaven.com/a/dark_wood), Poly Haven | Dimitrios Savva, Dario Barresi and Rico Cilliers |
| rosewood.jpg | [Rosewood Veneer 1](https://polyhaven.com/a/rosewood_veneer1), Poly Haven | Jenelle van Heerden |
| ebony.jpg | [Wood Table 001](https://polyhaven.com/a/wood_table_001), Poly Haven | Dimitrios Savva and Rico Cilliers |
| move-1.ogg, move-2.ogg, move-3.ogg, capture-1.ogg, capture-2.ogg | impactWood_light_000–002 and impactWood_medium_000–001 from [Impact Sounds](https://kenney.nl/assets/impact-sounds) 1.0 | Kenney (www.kenney.nl) |
| stack-1.ogg, stack-2.ogg, crown.ogg | chips-stack-1, chips-stack-2 and chip-lay-1 from [Casino Audio](https://kenney.nl/assets/casino-audio) 1.1 | Kenney (www.kenney.nl) |
