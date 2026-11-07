# Control flow

Blocks start with `then` or `do` and close with `end`. There's no implicit truthiness: a condition must be a `bool`.

```flywheel
var temperature = 18

if temperature > 25 then
    print "hot"
else if temperature > 15 then
    print "mild"
else
    print "cold"
end

int i = 0
while i < 3 do
    print "while", i
    i += 1
end

for n in [10, 20, 30] do
    print "for", n
end

for index, word in ["zero", "one", "two"] do
    print index, word
end
```

## One-call bodies with run

When a branch or loop body is a single function call, write it after `run` instead of `then`/`do` … `end`. There's no `end`, and the body can't be an assignment or a keyword statement such as `return`.

```flywheel
function greet(string size)
    print "a {size} number"
end

for n in [5, 50, 500] do
    if n > 100 run greet("big")
    else if n > 10 run greet("medium")
    else run greet("small")
end

var queue = ["a", "b"]
while queue.length > 0 run print "took", queue.pop()
for word in ["one", "two"] run print word
```

## Ranges and loops

`a..b` includes `b`; `a..<b` stops before it. `break` and `continue` work in every loop.

```flywheel
for n in 1..10 do
    if n % 2 == 0 then
        continue
    end
    if n > 7 then
        break
    end
    print n
end

print 1..4, 0..<3
for c in "abc" do
    print c, int(c)
end
```

## Comparisons chain

`a < b < c` means `a < b and b < c`, evaluating `b` once. Logic uses the words `and`, `or` and `not`, which short-circuit.

```flywheel
var x = 5
print 1 < x <= 10, 0 < x < 3
print not x == 4, x > 1 and x < 9, x == 5 or 1 // 0 == 0
```

## match

`match` compares one value against cases, top to bottom. Without an `else` it must cover every possibility.

```flywheel
function describe(int code) returns string
    match code
        case 0 then
            return "ok"
        case 1, 2 then
            return "warning"
        case 3..9 then
            return "error"
        else
            return "unknown"
    end
end

for code in [0, 2, 7, 42] do
    print code, describe(code)
end
```
