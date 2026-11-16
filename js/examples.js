/* Example programs for the playground. Apps return an element (or serve one) and show up in
 * the preview; event handlers that are Flywheel functions run live. */
(function (root) {
const EXAMPLES = [
{ id: "hello", name: "hello.fw", title: "Hello, world", code:
`# Welcome to the Flywheel playground. Press Ctrl+Enter (or ▶ Run) to run.
print "Hello, world!"

var name = "Flywheel"
int year = 2026
print "{name} says hi from {year}."

# format specs work like Python's
var price = 1234.5
print "{price:,.2f} | {42:>6} | {0.256:.1%} | {255:#x} | {"ok":*^6}"
`},
{ id: "tour", name: "tour.fw", title: "A tour of the language", code:
`import html.*

interface Shape
    function area() returns double
end

class Circle implements Shape
    double radius
    function area() returns double
        return 3.14159 * this.radius * this.radius
    end
end

class Square implements Shape
    double side
    constructor(double side)
        this.side = side
    end
    function area() returns double
        return this.side * this.side
    end
end

enum Size
    Small, Large
end

function size(Shape shape) returns Size
    match shape
        case Circle c if c.radius > 2.0 do
            return Size.Large
        case Square s if s.side > 3.0 do
            return Size.Large
        else do
            return Size.Small
    end
end

class Box<T>
    T value
end

Shape[] shapes = [Circle(1.0), Square(4.0)]
for shape in shapes do
    print shape.area(), size(shape)
end

int? best = null
print best otherwise 0, "héllo".length, 7.5 // 2, 1 < 2 < 3
print Box("generic").value
print <ul>{shapes.map(function(Shape s) => <li>{s.area()}</li>)}</ul>
`},
{ id: "counter", name: "counter.fw", title: "App: counter", app: true, code:
`# An app: the program returns an element tree, and the buttons call Flywheel
# functions. After every event the tree re-renders, like \`flywheel desktop\`.
import html.*

int count = 0
var label = <output id="count">0</output>

function change(int by)
    count += by
    label.text_content = string(count)
    if count < 0 do
        label.add_class("negative")
    else do
        label.remove_class("negative")
    end
end

function increment()
    change(1)
end

function decrement()
    change(-1)
end

function reset()
    change(-count)
end

return <html>
    <head>
        <title>Counter</title>
        <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f4ef; font-family: system-ui, sans-serif; color: #111; }
            main { background: white; border-radius: 18px; padding: 28px 36px; text-align: center; box-shadow: 0 20px 50px -25px rgba(0, 0, 0, .35); }
            h1 { font-size: 15px; letter-spacing: .2em; text-transform: uppercase; color: #888; margin: 0 0 6px; }
            output { display: block; font-size: 72px; font-weight: 800; font-variant-numeric: tabular-nums; }
            output.negative { color: #d33; }
            button { font: inherit; font-size: 22px; width: 56px; height: 48px; border-radius: 12px; border: 0; background: #111; color: #d4ff3a; cursor: pointer; margin: 0 4px; }
            button.reset { width: auto; padding: 0 16px; font-size: 14px; background: #e8e8e2; color: #111; }
        </style>
    </head>
    <body>
        <main>
            <h1>Counter</h1>
            {label}
            <button onclick={decrement}>−</button>
            <button onclick={increment}>+</button>
            <button class="reset" onclick={reset}>reset</button>
        </main>
    </body>
</html>
`},
{ id: "todo", name: "todo.fw", title: "App: todo list", app: true, code:
`# A todo list. Handlers receive the input's value when they take a string.
import html.*

class Task
    string title
    bool done = false
end

Task[] tasks = [Task("Try the playground"), Task("Read the docs", true), Task("Install Flywheel")]
string draft = ""
var list = <ul></ul>
var summary = <p class="summary"></p>

function toggler(Task task) returns function() returns void
    return function() returns void
        task.done = not task.done
        refresh()
    end
end

function remover(Task task) returns function() returns void
    return function() returns void
        tasks.remove(task)
        refresh()
    end
end

function refresh()
    list.clear()
    for task in tasks do
        var item = <li>
            <label><input type="checkbox" checked={task.done} onchange={toggler(task)}> {task.title}</label>
            <button class="x" onclick={remover(task)} title="remove">×</button>
        </li>
        if task.done do
            item.add_class("done")
        end
        list.append(item)
    end
    var left = tasks.filter(function(Task t) => not t.done).length
    summary.text_content = "{left} of {tasks.length} left"
end

function set_draft(string value)
    draft = value
end

function add()
    if draft.trim().length > 0 do
        tasks.push(Task(draft.trim()))
        draft = ""
        refresh()
    end
end

refresh()

return <html>
    <head>
        <title>Todo</title>
        <style>
            body { margin: 0; padding: 32px 16px; background: #101014; color: #f2f2ee; font-family: system-ui, sans-serif; }
            main { max-width: 420px; margin: 0 auto; }
            h1 { margin: 0 0 16px; font-size: 26px; }
            form, .add { display: flex; gap: 8px; margin-bottom: 14px; }
            input[type=text] { flex: 1; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid #2c2c35; background: #18181e; color: inherit; }
            button { font: inherit; border: 0; border-radius: 10px; padding: 0 14px; background: #d4ff3a; color: #111; font-weight: 700; cursor: pointer; }
            ul { list-style: none; padding: 0; margin: 0; }
            li { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; background: #18181e; margin-bottom: 6px; }
            li.done label { color: #777; text-decoration: line-through; }
            li .x { background: none; color: #888; font-size: 18px; padding: 0 6px; }
            .summary { color: #888; font-size: 13px; }
        </style>
    </head>
    <body>
        <main>
            <h1>Todo</h1>
            <div class="add">
                <input id="draft" type="text" placeholder="Add a task" value={draft} oninput={set_draft}>
                <button onclick={add}>Add</button>
            </div>
            {list}
            {summary}
        </main>
    </body>
</html>
`},
{ id: "chart", name: "chart.fw", title: "App: SVG chart", app: true, code:
`# Markup is just values: build an SVG chart from a map.
import html.*
import svg.*

map<string, int> stars = {"Flywheel": 42, "Pulley": 27, "vscode-flywheel": 19, "polymorphia.dev": 12}

var bars = <g></g>
int row = 0
int widest = 0
for name, n in stars do
    if n > widest do
        widest = n
    end
end
for name, n in stars do
    var y = 16 + row * 46
    var w = n * 360 // widest
    bars.append(<text x="150" y={y + 21} text-anchor="end" class="name">{name}</text>)
    bars.append(<rect x="160" y={y} width={w} height="30" rx="6" class="bar"/>)
    bars.append(<text x={168 + w} y={y + 21} class="n">{n}</text>)
    row += 1
end

return <html>
    <head>
        <title>Chart</title>
        <style>
            body { margin: 0; padding: 24px; font-family: ui-monospace, monospace; background: #0b0b0e; color: #eee; }
            h1 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
            .bar { fill: #d4ff3a; }
            .name { fill: #aaa; font-size: 13px; }
            .n { fill: #fff; font-size: 13px; font-weight: 700; }
        </style>
    </head>
    <body>
        <h1>stars (made up)</h1>
        <svg viewBox="0 0 600 200" width="100%">{bars}</svg>
    </body>
</html>
`},
{ id: "site", name: "site.fw", title: "App: page with components", app: true, code:
`# Components take attributes; web.serve shows the page for "/" in the preview.
import html.*
import web

class Release
    string version
    string date
    string[] notes
end

Release[] releases = [
    Release("2.9 beta-9", "2026-11", ["Named errors and assert", "<json> literals"]),
    Release("2.3 beta-3", "2026-10", ["Desktop windows on Windows", "Race detector: flywheel run --race"]),
    Release("2.2", "2026-07", ["Enums with data", "Format specs in interpolation"]),
    Release("2.1", "2026-04", ["Generic methods", "SQLite built in"])
]

component Card = <article class="card">
    <header><h2>{attr release.version}</h2><time>{attr release.date}</time></header>
    <ul>{attr release.notes.map(function(string n) => <li>{n}</li>)}</ul>
    {attr inner}
</article>

function index() returns element
    return <html>
        <head>
            <title>Changelog</title>
            <style>
                body { margin: 0; padding: 28px 20px; font-family: Georgia, serif; background: #faf8f2; color: #1d1d1b; }
                h1 { font-size: 30px; margin: 0 0 18px; }
                .card { background: white; border: 1px solid #e6e2d6; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; }
                .card header { display: flex; justify-content: space-between; align-items: baseline; }
                .card h2 { font-size: 18px; margin: 0; }
                time { color: #8a8578; font-size: 13px; }
                .latest { border-color: #1d1d1b; }
                .badge { display: inline-block; background: #1d1d1b; color: #d4ff3a; font: 11px ui-monospace, monospace; padding: 2px 8px; border-radius: 99px; }
            </style>
        </head>
        <body>
            <h1>Flywheel changelog</h1>
            <Card release={releases[0]}><span class="badge">latest</span></Card>
            {releases.slice(1).map(function(Release r) => <Card release={r}></Card>)}
        </body>
    </html>
end

print web.serve("/", index, 8000)
`},
{ id: "patterns", name: "patterns.fw", title: "Enums, match and operators", code:
`# Enums with data, destructuring, operator methods, defer, and format specs.

# An arithmetic expression tree.
enum Expr
    Number(double value)
    Add(Expr left, Expr right)
    Multiply(Expr left, Expr right)
    Negate(Expr inner)
end

function evaluate(Expr e) returns double
    match e
        case Expr.Number(v) do
            return v
        case Expr.Add(a, b) do
            return evaluate(a) + evaluate(b)
        case Expr.Multiply(a, b) do
            return evaluate(a) * evaluate(b)
        case Expr.Negate(inner) do
            return -evaluate(inner)
    end
end

function show(Expr e) returns string
    match e
        case Expr.Number(v) do
            return "{v:g}"
        case Expr.Add(a, b) do
            return "(" + show(a) + " + " + show(b) + ")"
        case Expr.Multiply(a, b) do
            return show(a) + " * " + show(b)
        case Expr.Negate(inner) do
            return "-" + show(inner)
    end
end

# A two-dimensional vector with operators.
class Vec2
    readonly double x
    readonly double y

    function operator +(Vec2 other) returns Vec2
        return Vec2(this.x + other.x, this.y + other.y)
    end

    function operator *(double k) returns Vec2
        return Vec2(this.x * k, this.y * k)
    end

    function operator ==(Vec2 other) returns bool
        return this.x == other.x and this.y == other.y
    end

    function to_string returns string
        return "({this.x:.1f}, {this.y:.1f})"
    end
end

function bounds(double[] values) returns [double, double]
    var low = values[0]
    var high = values[0]
    for v in values do
        if v < low do
            low = v
        end
        if v > high do
            high = v
        end
    end
    return [low, high]
end

function report(string title, double[] values)
    print "== " + title
    defer print "== end of " + title
    var (low, high) = bounds(values)
    print "{"low":<6}{low:>10.3f}"
    print "{"high":<6}{high:>10.3f}"
end

var tree = Expr.Add(Expr.Number(2.0), Expr.Multiply(Expr.Number(3.0), Expr.Negate(Expr.Number(4.0))))
print show(tree), "=", evaluate(tree)
print Expr.Number(1.0) == Expr.Number(1.0)

var v = Vec2(1.0, 2.0) + Vec2(0.5, 0.5) * 2.0
print v, v == Vec2(2.0, 3.0)

report("samples", [3.25, -1.5, 12.125])
`},
{ id: "errors", name: "errors.fw", title: "Errors and Results", code:
`# Typed exceptions with finally, and Result<T, E> values.
class ParseError
    string message
    int column
end

function parse_digit(string text, int column) returns int
    if text.length != 1 or not ("0" <= text and text <= "9") do
        throw ParseError("expected a digit, got '{text}'", column)
    end
    return int(text)
end

function sum_digits(string text) returns int
    int total = 0
    for i, c in text.chars() do
        total += parse_digit(string(c), i + 1)
    end
    return total
end

for input in ["1234", "12x4"] do
    try
        print input, "->", sum_digits(input)
    catch ParseError e
        print input, "-> error at column {e.column}: {e.message}"
    finally
        print "  (checked {input})"
    end
end

function divide(int n, int d) returns Result<int, string>
    if d == 0 do
        return Result.error("division by zero")
    end
    return Result.ok(n // d)
end

for d in [4, 0] do
    match divide(42, d)
        case ok value do
            print "42 // {d} = {value}"
        case error why do
            print "42 // {d} failed: {why}"
    end
end

try
    var scores = {"ann": 3}
    print scores["bo"]
catch KeyError e
    print "KeyError:", e.message
end
`},
{ id: "generics", name: "generics.fw", title: "Generics and iterators", code:
`# Generic classes and functions, constraints, and the iterator protocol.
class Stack<T>
    T[] items
    constructor()
        this.items = []
    end
    function push(T item)
        this.items.push(item)
    end
    function pop() returns T?
        if this.items.length == 0 do
            return null
        end
        return this.items.pop()
    end
end

function largest<T is comparable>(T[] items) returns T
    var best = items[0]
    for x in items do
        if x > best do
            best = x
        end
    end
    return best
end

class Countdown
    int n
    function next() returns int?
        if this.n == 0 do
            return null
        end
        this.n -= 1
        return this.n + 1
    end
end

Stack<string> names = Stack()
names.push("first")
names.push("second")
print names.pop() otherwise "empty", names.pop() otherwise "empty", names.pop() otherwise "empty"

print largest([3, 9, 2]), largest(["pear", "apple", "plum"])

for n in Countdown(3) do
    print "{n}..."
end
print "liftoff"

var squares = (1..5).map(function(int x) => x * x)
print squares, squares.reduce(0, function(int a, int b) => a + b)
`},
{ id: "match", name: "match.fw", title: "Match expressions and unless", code:
`# A match expression produces the value of the case that matches; \`unless c\` is \`if not (c)\`.
enum Shape
    Circle(double radius)
    Rect(double width, double height)
    Empty
end

function area(Shape s) returns double
    return match s
        case Shape.Circle(r) => 3.0 * r * r
        case Shape.Rect(w, h) => w * h
        case Shape.Empty => 0.0
    end
end

function size(int n) returns string
    return match n
        case 0 => "none"
        case 1..9 => "a few"
        case int k if k < 100 => "{k}, many"
        else => "lots"
    end
end

print area(Shape.Rect(2.0, 3.0)), area(Shape.Circle(1.0)), area(Shape.Empty)
for n in [0, 4, 42, 1000] do
    print n, size(n)
end

# Short ones fit on one line.
var grade = match 87 case 90..100 => 'A' case 80..<90 => 'B' else => 'C' end
Result<int, string> parsed = Result.error("not a number")
print grade, match parsed case ok v => "got {v}" case error e => "failed: {e}" end

bool ready = false
unless ready do
    print "not ready yet"
else do
    print "ready"
end
int tries = 3
unless tries > 5 run print("still trying")
unless tries == 3 do
    print "unexpected"
else unless tries > 3 do
    print "exactly three tries"
end
`},
{ id: "reactive", name: "reactive.fw", title: "Reactive variables", code:
`# Reactive variables: \`when\` runs its body each time a condition becomes true, and its \`else\`
# body each time the condition becomes false again. \`computed\` values follow their expression.

reactive bool playerAlive/playerDead = true
when playerDead do
    print "Game over!"
else do
    print "back in the game"
end
playerAlive = false
playerAlive = true

int score = 0
computed bool winning = score >= 10
when winning run print "winning with", score
score += 4
score += 7
score = 0
score = 12

# A condition can read fields: it is checked again whenever a field of that name is assigned.
class Player
    string name
    int health = 10
    function hit(int n) returns void
        this.health -= n
    end
end
var hero = Player("Ann")
when hero.health <= 0 run print hero.name, "is down"
hero.hit(4)
hero.hit(7)

# It can call functions: what they read counts too.
var x = 0
var y = 0
function far() returns bool
    return x * x + y * y > 25
end
when far() run print "far away at", x, y
x = 3
y = 5

# \`defer when\` is checked between statements, so a change made and undone inside one call is
# never seen, and a change left behind is seen once the call returns.
var height = 0.0
defer when height < -10 do
    print "fell from", height
    height = 0
end
function wobble() returns void
    height = -20
    height = 5
end
function drop() returns void
    height = -15
    print "dropping"
end
wobble()
drop()
print "height", height
`},
{ id: "units", name: "units.fw", title: "Units of measure", code:
`# Units of measure: the metric, imperial, and time libraries, and units of your own.
import metric
import imperial
import time

float[metric.length] trip = 12.5km
print trip in m, trip / 30min in kmph          # 12500m 25kmph
print 3m * 4m, 3m * 4m * 2m in l               # 12m2 24000l

float[imperial.length] run = 5mi
print run in ft, run / 40min in mph            # 26400ft 7.5mph
print 1m + 1ft, 1ft + 1m, 5ft in cm              # the second value in the first one's unit

# A namespace of your own; units apply to every numeric type.
unitns data
unit data.B = 1
unit data.KB = 1000
unit data.MB = 1000000
i64[data] download = 250MB
u8[data] header = 64B
print download + header, download in KB, type(download), unitns(header)

int[time] wait = 90s
print wait in min, wait < 2min, [1s, 1min, 1h]

# time.sleep takes seconds or a time quantity, converted to seconds
int[time] pause = 20ms
var start = time.monotonic()
time.sleep pause
time.sleep (pause in s).value
print time.monotonic() - start >= 0.04
`},
{ id: "snapshots", name: "snapshots.fw", title: "Snapshots: deep_copy and seeded random", code:
`# Saving and restoring a whole game state with deep_copy, with a seeded random.Generator of its
# own so the replay after a restore rolls the same numbers.
import random
import hot

class Fighter
    string name
    int health = 100
    int[] combo = []
end
class Match
    Fighter[] fighters = []
    random.Generator rng = random.Generator(7)
    int tick = 0
end

function play(Match m, int ticks)
    for i in 0..<ticks do
        m.tick += 1
        var target = m.fighters[m.rng.below(2)]
        var damage = m.rng.integer(5, 12)
        target.health -= damage
        target.combo.push(damage)
    end
end

var m = Match()
m.fighters.push(Fighter("Ryo"))
m.fighters.push(Fighter("Kei"))
play(m, 3)
var saved = deep_copy(m)
play(m, 4)
var first = "{m.fighters[0].health} {m.fighters[1].health} {m.fighters[0].combo}"
print "after 7 ticks:", first
m = deep_copy(saved)
print "restored to tick", m.tick, m.fighters[0].health, m.fighters[1].health
play(m, 4)
print "replayed:", "{m.fighters[0].health} {m.fighters[1].health} {m.fighters[0].combo}" == first
print "saved copy untouched:", saved.tick, saved.fighters[0].combo
print "hot reload here:", hot.enabled()
`},
];
root.FW_EXAMPLES = EXAMPLES;
if (typeof module !== "undefined" && module.exports) module.exports = EXAMPLES;
})(typeof self !== "undefined" ? self : globalThis);
