# Functions and lambdas

Functions declare typed parameters and a return type. Parameters can have defaults, and the outermost call in a statement can leave out its parentheses.

```flywheel
function greet(string name, string greeting = "Hello") returns string
    return "{greeting}, {name}!"
end

function fib(int n) returns int
    if n < 2 then
        return n
    end
    return fib(n - 1) + fib(n - 2)
end

print greet("Ann")
print greet("Bo", "Hi")
var message = greet "Cy", "Hey"
print message
print [1, 2, 3, 10, 20].map(fib)
```

A function that takes nothing can drop its `()`, and a bare function name on its own line calls it:

```flywheel
function banner
    print "=== report ==="
end

function answer returns int
    return 42
end

banner
print answer()
```

## Lambdas

`function(int x) => x * 2` is an expression lambda. The block form ends with `end` and declares `returns` when it has a result.

```flywheel
var double_it = function(int x) => x * 2
print double_it(21)

var words = ["flywheel", "pmsh", "polymorphia", "fw"]
print words.filter(function(string w) => w.length > 4)
print words.map(function(string w) => w.upper())
print words.reduce(0, function(int total, string w) => total + w.length)

words.sort(function(string a, string b) => a.length < b.length)
print words
```

## Closures share their variables

A lambda captures the variables around it. When a captured variable is assigned, every closure sees the same, current value: that's how this counter keeps its count.

```flywheel
function counter() returns function() returns int
    int count = 0
    return function() returns int
        count += 1
        return count
    end
end

var next_id = counter()
next_id()
next_id()
print next_id(), next_id()

var other = counter()
print other()
```

Methods are values too: `obj.method` is a function bound to `obj`, so `[1, 2, 3].map(account.add)` works.
