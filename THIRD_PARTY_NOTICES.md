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
