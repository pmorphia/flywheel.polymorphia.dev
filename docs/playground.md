# The playground

The Flywheel compiler is C++ on top of LLVM and produces native executables, so it can't run inside a web page. This site runs Flywheel with **[flywheel.js](https://github.com/fwlang/flywheel.js)** instead. It is the JavaScript flavor of Flywheel that follows the compiler's semantics and output formatting, and its output was checked against `flywheel run` on the repository's examples and the code in these docs. flywheel.js also runs in Node (`npx flywheel-js run main.fw`) if you want it outside the browser.

## What works

- The whole core language: classes, `constructor` / `destructor`, multiple inheritance and `super`, `static` members, access modifiers, decorators, the `x if c else y` ternary, `spawn`, interfaces, operators, `to_string`, enums (including enums with data), `match` statements and expressions (`case p => value`) with every pattern kind, `unless` (`if not`), one-call bodies after `run`, generics, nullable values with `otherwise` fallbacks (`a otherwise b`, formerly `a ?? b`), closures, first-class methods, `defer`, `try`/`catch`/`finally` (with named errors such as `throw "Name" with "message"` and `catch "Name" e`, and `assert`), `Result<T, E>`, format specs, ranges, tuples and destructuring.
- Collections: arrays, maps, sets, tuples, freezing, sorting and the higher-order helpers.
- Reactive variables: `reactive` and `computed` declarations, `when condition do ... else do ... end`, and `defer when`.
- Units of measure: `unitns`, `unit`, `unitconv`, quantity literals (`100m`, `0.32km`), `x in cm`, and the `metric`, `imperial` and `time` unit libraries.
- `deep_copy(value)`, and `random.Generator(seed)`, which gives the same numbers as the compiler for the same seed.
- Markup with `html.*` and `svg.*`, components, element families, CSS-selector queries, mutation and `html.parse`.
- Apps: a program that **returns an element**, calls **`web.serve("/", …)`**, or loads a **`desktop.window`** is shown in the preview. Flywheel event handlers (`onclick={f}`, `oninput={f}`, …) run live, and the page re-renders after each event, as in desktop windows.
- Library modules that make sense in a browser: `math`, `random`, `collections`, `json` (including `<json>` literals), `regex`, `time`, `encoding`, `uuid`, `testing`, `html`.
- String imports of those modules, such as `import "math"`, and a top-level `return n` exit status.
- **pmsh**: `flywheel run`, `flywheel check` and `flywheel repl` work on the editor's program and the examples.

## What doesn't

- The type checker. Programs the compiler would reject (for example mixing `int` and `double` without a cast) may still run here, so check real projects with `flywheel check`.
- Modules that need the operating system: `fs`, `io`, `os` (except `exit`), `net`, `thread`, `sqlite`, `compress`, `crypto`, and the HTTP client in `web`. Importing one is an error that says so. `import c`, `import++`, `import rust` and `import zig` raise a catchable `NativeError`, and importing files or URLs is not available. `json.load`, `json.dump` and `flywheel.run` only work when flywheel.js runs under Node.
- Performance: the interpreter is far slower than native code, and programs that run longer than six seconds are stopped.
- Integers are exact 64-bit values with overflow checks, as in the compiler; native-only details such as stack depth differ.

To get the real thing, use the **Install** button, which opens a menu comparing the native compiler with flywheel.js, or run `install` in pmsh.
