# The playground

The Flywheel compiler is C++ on top of LLVM and produces native executables, so it can't run inside a web page. This site runs Flywheel with **[flywheel.js](https://github.com/fwlang/flywheel.js)** instead. It is a JavaScript implementation of the language that follows the compiler's semantics and output formatting, and its output was checked against `flywheel run` on the repository's examples and the code in these docs. flywheel.js also runs in Node (`npx flywheel-js run main.fw`) if you want it outside the browser.

## What works

- The whole core language: classes, `init`, inheritance and `super`, interfaces, operators, `to_string`, enums (including enums with data), `match` with every pattern kind, generics, nullable values, closures, first-class methods, `defer`, `try`/`catch`/`finally`, `Result<T, E>`, format specs, ranges, tuples and destructuring.
- Collections: arrays, maps, sets, tuples, freezing, sorting and the higher-order helpers.
- Markup with `html.*` and `svg.*`, components, element families, CSS-selector queries, mutation and `html.parse`.
- Apps: a program that **returns an element**, calls **`web.serve("/", …)`**, or loads a **`desktop.window`** is shown in the preview. Flywheel event handlers (`onclick={f}`, `oninput={f}`, …) run live, and the page re-renders after each event, as in desktop windows.
- Library modules that make sense in a browser: `math`, `collections`, `json`, `regex`, `time`, `encoding`, `uuid`, `testing`, `html`.
- **pmsh**: `flywheel run`, `flywheel check` and `flywheel repl` work on the editor's program and the examples.

## What doesn't

- The type checker. Programs the compiler would reject (for example mixing `int` and `double` without a cast) may still run here, so check real projects with `flywheel check`.
- Modules that need the operating system: `fs`, `io`, `os` (except `exit`), `net`, `thread`, `sqlite`, `compress`, `crypto`, and the HTTP client in `web`. Importing one is an error that says so.
- Performance: the interpreter is far slower than native code, and programs that run longer than six seconds are stopped.
- Integers are exact 64-bit values with overflow checks, as in the compiler; native-only details such as stack depth differ.

To get the real thing, use the **Install** button or run `install` in pmsh.
