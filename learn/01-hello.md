# Hello, Flywheel

Flywheel is a compiled language: `flywheel run` turns your program into native code through LLVM and runs it. This playground runs the same programs in your browser so you can try things without installing anything.

The program for each lesson is already in the editor. Press **Ctrl+Enter** (or **▶ Run**) and the output appears in **pmsh** below the app preview.

```flywheel
print "Hello, world!"

var name = "Flywheel"
int year = 2026
print "{name} says hi from {year}."
print 7 / 2, 7 // 2, 7 % 2
```

## Values and variables

`var` infers a variable's type; writing the type first declares it explicitly. Types are checked by the compiler, and an `int` never silently turns into a `double`.

```flywheel
var count = 3            # int
double ratio = 0.75
string label = "items"
bool ready = true
char initial = 'F'
const int LIMIT = 10

print count, ratio, label, ready, initial, LIMIT
print count * 2 + LIMIT, ratio * 4.0
```

`/` always gives a `double`, and `//` is integer division that rounds towards zero. Integer overflow is an error, not a wrap-around.

## Strings and interpolation

`{expression}` inside a string interpolates. A `{` followed by a space stays a literal brace, so CSS and JavaScript read naturally. After a `:` comes a format spec, as in Python:

```flywheel
var price = 1234.5
var n = 42
print "total: {price:,.2f} EUR"
print "[{n:>6}] [{n:<6}] [{n:^6}] [{n:06}]"
print "{0.256:.1%} of {255:#x}"
print "a literal { brace } and {{doubled}}"

var s = "héllo"
print s.length, s.upper(), s[1], s[1..3], s.replace("l", "L")
```

`print a, b, c` prints values separated by spaces. Calls at the start of a statement can drop their parentheses (`print "x"` is `print("x")`), but nested calls need them.

:::note
Try changing the format specs: `{price:.0f}`, `{n:b}`, `{n:+d}`, or `{"ok":*^9}`.
:::
