# Markup and components

Markup is part of the language. With `import html.*`, a tag is an expression that builds an element tree, `{expression}` inserts values (escaped), and printing an element gives HTML.

```flywheel
import html.*

var name = "Flywheel & friends"
var items = ["fast", "typed", "native"]
var card = <section class="card">
    <h1>Hello, {name}</h1>
    <ul>{items.map(function(string i) => <li>{i}</li>)}</ul>
</section>
print card
print card.query_all("li").length, card.query("h1").text_content
```

## Components

A component is a named piece of markup. `{attr x}` reads an attribute passed by the caller, `{attr inner}` is the content between its tags, and `style` defaults to empty.

```flywheel
import html.*

class User
    string name
    int age
end

component Badge = <span class="badge {attr kind}">{attr inner}</span>
component UserCard = <div class="user" style={attr style}>
    <h2>{attr user.name}</h2>
    <p>Age: {attr user.age}</p>
    {attr inner}
</div>

var u = User("Ann", 31)
print <UserCard user={u}><Badge kind="admin">admin</Badge></UserCard>
```

## Querying and changing trees

Trees support CSS selectors and DOM-style mutation. Results point into the original tree, so changes show up when it renders.

```flywheel
import html.*

var page = <main>
    <h1 id="title">Welcome</h1>
    <section class="cards"><p>First</p><p>Second</p><p>Third</p></section>
</main>

var title = page.query("#title")
if title != null then
    title.text_content = "Hello & welcome!"
end
for p in page.query_all(".cards p:nth-child(odd)") do
    p.add_class("highlight")
end
page.query(".cards").append(<p>Fourth</p>)
print page
```

In the next lesson the tree stops being text and becomes a live app.
