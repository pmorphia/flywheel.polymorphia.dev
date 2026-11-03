# Collections

Arrays, maps and sets share their identity: assigning one to another variable aliases it, so changes show through both names.

```flywheel
int[] values = [5, 3, 9]
values.push(1)
values.sort()
print values, values.length, values[0], values[1..2]
print values.contains(9), 9 in values, values.index_of(3)

var alias = values
alias.push(100)
print values

print values.slice(1, 3), values.join(" + ")
```

## Maps

Maps keep insertion order. A missing key is a `KeyError`, so check with `in` first when a key might be absent.

```flywheel
map<string, int> scores = {"Ann": 15}
scores["Ann"] += 1
scores["Bo"] = 20
print scores, scores.length, "Bo" in scores

for name, score in scores do
    print "{name}: {score}"
end

print scores.keys(), scores.values(), "Cy" in scores
print scores.remove("Ann"), scores
```

## Sets

```flywheel
set<int> seen = {3, 1, 3}
seen.add(5)
print seen, 1 in seen, seen.length
print seen.union({9}), seen.intersection({1, 5}), seen.difference({1})
print set("hello")
```

## Tuples and destructuring

Square brackets with mixed types make a tuple, which prints with parentheses. `var (a, b) = ...` unpacks one.

```flywheel
function min_max(int[] xs) returns [int, int]
    var sorted = xs.copy()
    sorted.sort()
    return [sorted[0], sorted[sorted.length - 1]]
end

var (low, high) = min_max([7, 2, 9, 4])
print low, high

var pair = ["answer", 42]
print pair, pair[1]
print [1, 2] * 3, "ab" * 2
```

## Frozen collections

`freeze()` makes a collection read-only in place. Changing it afterwards raises `ValueError`.

```flywheel
var primes = [2, 3, 5, 7].freeze()
try
    primes.push(11)
catch ValueError e
    print e.message
end
print primes, primes.is_frozen()
```
