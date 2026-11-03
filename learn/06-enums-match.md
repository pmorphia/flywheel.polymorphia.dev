# Enums and pattern matching

An enum lists its members. They print as their names, compare with `==`, and know their position.

```flywheel
enum Color
    Red, Green
    Blue
end

var c = Color.Green
print c, c.name, c.value
print Color.values()
print Color.from_name("Blue") ?? Color.Red
```

## Enums with data

Members can carry fields. `match` then destructures them, and the compiler checks that every member is handled.

```flywheel
enum Shape
    Circle(double radius)
    Rect(double width, double height)
    Empty
end

function area(Shape s) returns double
    match s
        case Shape.Circle(r) then
            return 3.14159 * r * r
        case Shape.Rect(w, h) then
            return w * h
        case Shape.Empty then
            return 0.0
    end
end

Shape[] shapes = [Shape.Circle(1.0), Shape.Rect(2.0, 3.0), Shape.Empty]
for s in shapes do
    print s, area(s)
end
print Shape.Rect(1.0, 2.0) == Shape.Rect(1.0, 2.0)
```

## Matching on types, with guards

`case Circle c` matches instances of a class and binds them. A guard (`if ...`) adds a condition. `case [x, y]` destructures tuples and arrays.

```flywheel
class Circle
    double radius
end
class Square
    double side
end

function label(Circle c) returns string
    return "circle {c.radius}"
end

function judge(int[] pair) returns string
    match pair
        case [0, 0] then
            return "origin"
        case [x, 0] then
            return "on the x axis at {x}"
        case [x, y] if x == y then
            return "diagonal"
        else
            return "somewhere"
    end
end

print judge([0, 0]), judge([4, 0]), judge([3, 3]), judge([1, 2])
print label(Circle(2.5))
```

## Nullable values

`T?` can hold `null`. `??` supplies a fallback, and a null check narrows the type inside the `if`.

```flywheel
function find(int[] xs, int x) returns int?
    for i, item in xs do
        if item == x then
            return i
        end
    end
    return null
end

var at = find([4, 8, 15], 8)
print at ?? -1, find([4], 9) ?? -1
if at != null then
    print "found at", at + 1
end
```
