# Errors, Results and defer

`throw` raises a value; `catch Type name` handles that type, and `finally` (or `then`) always runs. You can also raise an error by name without declaring a class: `throw "Name" "message"` is caught by `catch "Name" e`, and `assert condition "message"` raises an `AssertionError`. Built-in errors include `KeyError`, `IndexError`, `ValueError` and `NumericError`.

```flywheel
class ParseError
    string message
end

function parse_age(string text) returns int
    if text.trim().length == 0 then
        throw ParseError("empty input")
    end
    var n = int(text)
    if n < 0 then
        throw ValueError("age can't be negative")
    end
    return n
end

for input in ["42", "", "-3", "x"] do
    try
        print "age", parse_age(input)
    catch ParseError e
        print "parse error:", e.message
    catch ValueError e
        print "value error:", e.message
    catch e
        print "other error:", e
    finally
        print "  checked '{input}'"
    end
end
```

## Named errors and assert

For a quick error you don't need a class. `throw "Name" "message"` raises an error called `Name`, and `catch "Name" e` handles it. Every error has `.name` and `.message`. `assert` raises an `AssertionError` when its condition is false, and `then` is another spelling of `finally`.

```flywheel
function load(string key) returns string
    if key == "" then
        throw "EmptyKey" "the key is empty"
    end
    return key
end

for key in ["name", ""] do
    try
        print "loaded", load(key)
    catch "EmptyKey" e
        print e.name + ":", e.message
    then
        print "  done with '{key}'"
    end
end

try
    assert 2 + 2 == 5 "arithmetic broke"
catch AssertionError a
    print a.message
end
```

## Result values

`Result<T, E>` makes failure part of the return type instead of an exception. Handle it with `match`, or check `is_ok` and `unwrap()`.

```flywheel
function divide(int n, int d) returns Result<int, string>
    if d == 0 then
        return Result.error("division by zero")
    end
    return Result.ok(n // d)
end

for d in [5, 0] do
    match divide(20, d)
        case ok q then
            print "20 // {d} = {q}"
        case error why then
            print "failed:", why
    end
end

var r = divide(9, 3)
print r, r.is_ok, r.unwrap()
```

## defer

`defer` runs a statement when the enclosing block ends, however it ends. Several defers run in reverse order, which makes cleanup read next to setup.

```flywheel
function work(int steps)
    print "open"
    defer print "close"
    defer print "flush"
    for i in 1..steps do
        if i == 3 then
            print "giving up at", i
            return
        end
        print "step", i
    end
end

work(2)
work(5)
```
