# Classes and interfaces

A class lists its fields and methods. Inside a method, `inst` names the object: `inst age` reads a field and `inst greet()` calls a method. The generated constructor takes the fields in order, and fields with defaults can be left out.

```flywheel
class Person
    string name
    int age = 0

    function greet() returns string
        return "Hello, {inst name}!"
    end

    function birthday()
        inst age += 1
    end
end

var ann = Person("Ann", 30)
var bo = Person "Bo"
bo.birthday()
print ann.greet(), bo.age
print ann
```

## init, private and readonly

Writing `init` replaces the generated constructor. `private` members are only visible inside the class, and `readonly` fields can only be set while constructing.

```flywheel
class Temperature
    readonly double celsius
    function init(double fahrenheit)
        inst celsius = (fahrenheit - 32.0) * 5.0 / 9.0
    end
end

class Account
    readonly string id
    private int balance = 0
    function deposit(int amount)
        inst balance += amount
    end
    function total returns int
        return inst balance
    end
end

print Temperature(212.0).celsius
var acct = Account("acct-1")
acct.deposit(5)
acct.deposit(7)
print acct.id, acct.total()
```

## Inheritance and interfaces

`extends` inherits fields and methods; an override must keep the same signature, and `super.method()` calls the parent's version. An interface lists methods that implementing classes must provide.

```flywheel
interface Shape
    function area() returns double
    function name() returns string
end

class Rectangle implements Shape
    double width
    double height
    function area() returns double
        return inst width * inst height
    end
    function name() returns string
        return "rectangle"
    end
end

class Square extends Rectangle
    function init(double side)
        super.init(side, side)
    end
    function name() returns string
        return "square"
    end
end

Shape[] shapes = [Rectangle(2.0, 3.0), Square(4.0)]
for s in shapes do
    print s.name(), s.area(), s is Square
end
```

## Operators and printing

A class can define `operator +`, `operator ==`, `operator <` and friends, plus `to_string` to control how it prints.

```flywheel
class Money
    readonly int cents
    function operator +(Money other) returns Money
        return Money(inst cents + other.cents)
    end
    function operator <(Money other) returns bool
        return inst cents < other.cents
    end
    function to_string returns string
        return "${inst cents // 100}.{inst cents % 100:02}"
    end
end

var total = Money(150) + Money(275)
print total, Money(99) < total
```
