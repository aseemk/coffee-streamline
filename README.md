# Coffee-Streamline

Helper for efficiently `require()`'ing [CoffeeScript][] and/or [Streamline][]
files. The key word is "efficiently": compiled code is cached to prevent
recompilation on subsequent runs.

[coffeescript]: http://coffeescript.org/
[streamline]: https://github.com/Sage/streamlinejs

Note that Streamline does natively support caching compiled code, but it only
caches the Streamline compilation; CoffeeScript is compiled every time there.
This module caches both types of compilation.

This module is also robust to version changes (upgrades) to both CoffeeScript
and Streamline; files will be properly recompiled in those cases.

## Installation

```
npm install coffee-streamline
```

Note that CoffeeScript and Streamline should also be installed like normal,
e.g. your package.json should specify the desired versions of those.

## Usage

You can simply `require()` this module in place of both CoffeeScript and
Streamline; all proper `require()` handlers will be registered:

```js
require('coffee-streamline');
```

You can then `require()` CoffeeScript and/or Streamline files like normal, and
they'll be compiled and cached automatically:

```js
require('./foo');   // e.g. foo.coffee
require('./bar');   // e.g. bar._js
require('./baz');   // e.g. baz._coffee
```

## Details

Cached files are stored in a `.cache` directory under the current working
directory at runtime (`process.cwd()`). This is to support deploying the
compiled files alongside the source ones, e.g. via rsync.

Currently, Streamline compilation happens under "callback" mode.

## TODO

Support configuration/options, e.g. cache directory location and Streamline
compilation mode (callbacks or fibers).

Can/should some of this be integrated into Streamline directly?

## License

MIT. &copy; 2012 Aseem Kishore.

## Credits

[Jeremy Ashkenas](https://github.com/jashkenas) for the awesome CoffeeScript,
and [Bruno Jouhier](https://github.com/bjouhier) for the awesome Streamline.
