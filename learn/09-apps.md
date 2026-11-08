# Building an app

When the top level of a program **returns** an element, `flywheel desktop` shows it in a native window and `flywheel serve` serves it over HTTP. In the playground it appears in the **app** preview.

Event attributes such as `onclick` can hold Flywheel functions. After each event the tree re-renders, so a handler just changes the tree, or the data it's built from. A handler that takes a `string` receives the element's value, which suits inputs.

```flywheel
import html.*

string name = ""
var greeting = <p class="greeting">Type your name…</p>

function typed(string value)
    name = value.trim()
    if name.length == 0 do
        greeting.text_content = "Type your name…"
    else do
        greeting.text_content = "Hello, {name}! That's {name.length} letters."
    end
end

return <html>
    <head>
        <title>Greeter</title>
        <style>
            body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; background: #fafaf7; }
            input { font: inherit; font-size: 18px; padding: 10px 14px; border-radius: 10px; border: 1px solid #ccc; width: 260px; }
            .greeting { font-size: 22px; font-weight: 600; }
        </style>
    </head>
    <body>
        <input id="name" placeholder="Your name" oninput={typed}>
        {greeting}
    </body>
</html>
```

Run it, then type in the preview.

## State, handlers and lists

Here the data lives in an array, and `refresh` rebuilds the list from it. Each button gets its own closure, made by a small function so every closure captures its own item.

```flywheel
import html.*

class Item
    string name
    int votes = 0
end

Item[] items = [Item("Pattern matching"), Item("Native markup"), Item("Generics")]
var list = <ol></ol>

function voter(Item item) returns function() returns void
    return function() returns void
        item.votes += 1
        refresh()
    end
end

function refresh()
    items.sort(function(Item a, Item b) => a.votes > b.votes)
    list.clear()
    for item in items do
        list.append(<li><button onclick={voter(item)}>▲ {item.votes}</button> {item.name}</li>)
    end
end

refresh()

return <html>
    <head>
        <title>Favourite feature</title>
        <style>
            body { font-family: system-ui, sans-serif; padding: 24px; }
            li { margin: 8px 0; font-size: 17px; }
            button { font: inherit; font-size: 14px; border: 1px solid #ccc; background: white; border-radius: 8px; padding: 2px 10px; cursor: pointer; margin-right: 8px; }
        </style>
    </head>
    <body>
        <h1>Favourite feature</h1>
        {list}
    </body>
</html>
```

## Serving pages

`web.serve(route, handler, port)` registers a page. On your machine it starts an HTTP server; here the preview shows the `/` route. Served pages don't run Flywheel event handlers, since a browser can't call back into the program.

```flywheel
import html.*
import web

function index() returns element
    return <html><body><h1>Served by Flywheel</h1><p>The time is now.</p></body></html>
end

print web.serve("/", index, 8000)
```

That's the tour. Load the **todo** and **chart** examples from the editor's menu for bigger apps, read the [docs](#/docs), and when you're ready, install the compiler with the **Install** button.
