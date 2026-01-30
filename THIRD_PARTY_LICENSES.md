# Third-Party Licenses

This extension uses the following third-party components:

## Sharp (Apache-2.0 AND LGPL-3.0-or-later)

- **Website:** https://sharp.pixelplumbing.com/
- **GitHub:** https://github.com/lovell/sharp
- **License:** Apache-2.0 (Sharp) AND LGPL-3.0-or-later (libvips)

Sharp is a high-performance image processing library built on libvips.

### libvips

- **Website:** https://www.libvips.org/
- **GitHub:** https://github.com/libvips/libvips
- **License:** LGPL-3.0-or-later

### LGPL-3.0-or-later Compliance Notice

This extension includes precompiled libvips binaries as part of the Sharp package. Under the terms of the LGPL-3.0-or-later license, you have the following rights:

1. **Modify the library:** You may modify the libvips library source code
2. **Replace the bundled version:** You may replace the bundled libvips binaries with your own modified version
3. **Obtain source code:** The libvips source code is available at https://github.com/libvips/libvips

For instructions on building Sharp with a custom libvips version, see: https://sharp.pixelplumbing.com/install#custom-libvips

---

## @kkdev92/vscode-ext-kit (MIT)

- **License:** MIT

A utility library for VS Code extension development providing logging, configuration, and command management utilities.

---

## Development Dependencies

The following development dependencies are used during build and testing only (not included in the distributed extension):

| Package | License |
|---------|---------|
| TypeScript | Apache-2.0 |
| ESLint | MIT |
| esbuild | MIT |
| Vitest | MIT |
| @vscode/vsce | MIT |

---

## License Texts

### MIT License

```
MIT License

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
```

### Apache License 2.0

See: https://www.apache.org/licenses/LICENSE-2.0

### LGPL-3.0-or-later

See: https://www.gnu.org/licenses/lgpl-3.0.html
