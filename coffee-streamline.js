var FS = require('fs');
var Module = require('module');
var Path = require('path');

function loadCoffee() {
    return require('coffee-script');
}

// streamline can compile to callbacks or fibers. fibers offers way better
// readability and debuggability, but not safe to use until node 0.8!
function loadStreamline(mode) {
    mode = mode || 'callbacks';

    // streamline 0.2+ hooks into the require() pipeline by monkey-patching
    // the underlying Module::_compile() method instead of registering a
    // regular require() extension handler. it *does* cache output there, but
    // it only gets JS as input, so .coffee files still compile every time.
    // to prevent this, we reset Module::_compile() after loading streamline,
    // and handle compilation and caching ourselves as below.
    // streamline 0.3.1+ changed its API to require an explicit register()
    // call before it did this, but that register() call is idempotent, so we
    // call it ourselves to ensure that it won't have any effect later.

    // "remember" the original Module::_compile():
    var Module = require('module');
    var Module_compile = Module.prototype._compile;

    // load Streamline and ensure it registers itself:
    var streamline = require('streamline');
    streamline.register({
        fibers: mode === 'fibers'
    });

    // then reset Module::_compile():
    Module.prototype._compile = Module_compile;

    // streamline 0.3+ no longer exposes its compiler on the regular returned
    // streamline object, since it depends on the mode now, so we grab that:
    return require('streamline/lib/' + mode + '/transform');
}

var Coffee = loadCoffee();
var Streamline = loadStreamline();


// =========
// CONSTANTS
// =========

var CWD = process.cwd();
var CWD_LENGTH = CWD.length;

// path to cache directory: this directory can/should be e.g. git-ignored.
// TODO ideally, this would be inside a system temp directory or similar?
// update: should include the CS and streamline versions to support upgrades!
var CACHE_PATH = '.cache/' + Coffee.VERSION + '-' + Streamline.version;


// ==========
// FS HELPERS
// ==========

// synchronously creates the directory at the given path, including all
// intermediate directories, if it doesn't already exist. (like `mkdir -p`)
function mkdirpSync(dir) {

    // normalize and resolve path to an absolute one:
    // (path.resolve automatically uses the current directory if needed)
    dir = Path.resolve(Path.normalize(dir));

    // try to create this directory:
    try {

        // XXX hardcoding recommended file mode of 511 (0777 in octal)
        // (note that octal numbers are disallowed in ES5 strict mode)
        FS.mkdirSync(dir, 511);

    // and if we fail, base action based on why we failed:
    } catch (e) {

        // XXX Node 0.6 seems to break e.errno -- doesn't match constants
        // anymore! see: http://stackoverflow.com/a/9254101/132978
        switch (e.code) {

            // base case: if the path already exists, we're good to go.
            // TODO account for this path being a file, not a dir?
            case 'EEXIST':
                return;

            // recursive case: some directory in the path doesn't exist, so
            // make this path's parent directory.
            case 'ENOENT':
                mkdirpSync(Path.dirname(dir));
                mkdirpSync(dir);
                break;

            default:
                throw e;

        }
    }
}

// synchronously fetches and returns the last modified time of the file or dir
// at the given path, or 0 if no file or dir exists at this path.
function mtimeSync(path) {
    try {
        return FS.statSync(path).mtime;
    } catch (e) {
        return 0;
    }
}

function readFileSync (path) {
    return FS.readFileSync(path, 'utf8');
}

function writeFileSync (path, content) {
    return FS.writeFileSync(path, content, 'utf8');
}


// ==========
// MAIN LOGIC
// ==========

// Here's how this works: when you require() any file, Node tells us the full
// absolute path to the file, e.g. /Users/aseemk/Projects/Foo/bar_.coffee or
// /usr/local/lib/node/.npm/foo/bar.js.
//
// When you require() a file that's Coffee and/or Streamline, and we end up
// compiling it, we'll cache the compiled output at the same path as the
// source file, except under our cache directory. E.g. if our cache directory
// is at /path/to/.cache, and you require() a file at /path/to/source.coffee,
// we'll cache the compiled output at /path/to/.cache/path/to/source.coffee.
//
// So now when you require() a file that's Coffee and/or Streamline, we'll
// first check our cache to see if we have an up-to-date compiled copy. If so,
// we'll use that. Otherwise, we'll compile it and cache it. We determine if
// it's up-to-date via the last modified time (mtime).

// make the cache directory if it doesn't already exist
mkdirpSync(CACHE_PATH);

// helper function: reads and compiles the Coffee and/or Stremaline file at
// the given path, returning the compiled output.
function compileSync(sourcePath) {
    var ext = Path.extname(sourcePath);

    // regardless of type, read in the source file, and assume initially that
    // the source is itself the compiled output.
    var source = readFileSync(sourcePath);
    var output = source;

    // if the source file is coffee, transform it to JS
    if (ext === '.coffee' || ext === '._coffee') {
        output = Coffee.compile(output, {
            filename: sourcePath,
            bare: true,     // to support streamline
        });
    }

    // if the source file is streamlined, transform it to regular.
    // this could be _.js or _.coffee (old), or ._js or ._coffee (new).
    // TODO support file-level options when transforming streamline code.
    if (sourcePath.match(/(_\.|\._)(js|coffee)$/)) {
        output = Streamline.transform(output, {
            lines: 'preserve'
        });
    }

    // finally, regardless of any transformation, use and return the output
    return output;
}

// main require() handler:
function requireSync(module, sourcePath) {
    var content = '';

    // derive the cached path of this file: cache dir + source path.
    // optimization: if this file is within the current working directory,
    // we'll use a relative source path instead of an absolute one.
    // to prevent collisions, we separate relative paths from absolute ones.
    // (note that path.relative() is only available on node 0.6 onwards, but
    // it's not what we want here anyway; we want to test relativity rather
    // than force it, and we also don't want any ..'s in our path.)
    var subpath;
    if (sourcePath.indexOf(CWD) === 0) {
        subpath = Path.join('rel', sourcePath.substr(CWD_LENGTH));
    } else {
        subpath = Path.join('abs', sourcePath);
    }
    var cachedPath = Path.join(CACHE_PATH, subpath);

    // read mtimes of source path and cached path
    var sourceMtime = mtimeSync(sourcePath);
    var cachedMtime = mtimeSync(cachedPath);

    // if the cached copy is up-to-date, use its content
    if (cachedMtime >= sourceMtime) {
        content = readFileSync(cachedPath);
    }

    // otherwise, compile the source and cache it
    else {
        content = compileSync(sourcePath);

        // make sure the cached copy's directory exists before writing it:
        mkdirpSync(Path.dirname(cachedPath));
        writeFileSync(cachedPath, content);
    }

    // finally, use this content for the require()...
    module._compile(content, sourcePath);

    // ...but be robust to other tools overwriting our require() hooks, e.g. if
    // coffeescript is included again by a dependendency; reset our hooks in
    // case they were overwritten. this ensures our hooks are always used.
    // XXX this isn't very friendly to other modules; TODO FIXME somehow?
    registerExtensions();
}

// overwrite the require() handlers for our expected extensions w/ ours above:
function registerExtensions() {
    ['.js', '.coffee', '._js', '._coffee'].forEach(function (ext) {
        require.extensions[ext] = requireSync;
    });
}

// and finally, do just that!
registerExtensions();

// public run() method to run files as main, by reusing the current "main"
// module (modeled off of CoffeeScript's technique, also now Streamline's):
exports.run = function run(path) {
    // if relative, resolve path relative to the parent module, but either
    // way, resolve it to a runnable Node file:
    var path = Path.resolve(module.parent.filename, path);
    var filename = Module._resolveFilename(path);

    // clear and reset the current main module to the passed-in path:
    var mainModule = require.main;
    mainModule.id = filename;
    mainModule.filename = filename;
    mainModule.paths = Module._nodeModulePaths(Path.dirname(filename));
    mainModule.cache = {};

    // and finally, run it! update: go through the currently-set require()
    // handler instead of calling requireSync() directly in order to support
    // wrapper handlers, e.g. node-dev's which watches on require().
    require.extensions[Path.extname(filename)](mainModule, filename);
};
