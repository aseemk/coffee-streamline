# coffee-streamline.coffee
# Handler for efficiently require()-ing CoffeeScript and/or Streamline files.
# The key word is efficiently: caches compiled code to prevent recompilation.
#
# Note that Streamline does cache compilation output natively, but only if you
# keep the output file around next to the source file, which sucks since it
# clutters up source control or requires manual ignoring of each output file.
# This library thus mimics much of Streamline's caching logic, but stores
# output files in a cache directory instead. Many thanks to Bruno Jouhier!
#
# Usage:
# require('coffee-streamline');

fs = require 'fs'
path = require 'path'

loadCoffee = ->
    require 'coffee-script'

# streamline can compile to callbacks or fibers. fibers offers way better
# readability and debuggability, but not safe to use until node 0.8!
loadStreamline = (mode='callbacks') ->
    # streamline 0.2+ hooks into the require() pipeline by monkey-patching the
    # underlying Module::_compile() method instead of registering a regular
    # require() extension handler. it *does* cache output there, but it only
    # gets JS as input, so .coffee files still get compiled every time.
    # to prevent this, we reset Module::_compile() after loading streamline,
    # and handle compilation and caching ourselves as below.
    # streamline 0.3.1+ also changed its API to require an explicit register()
    # call before it did this, but that register() call is idempotent, so we
    # call it ourselves to ensure that it won't have any effect later.

    # "remember" the original Module::_compile():
    Module = require 'module'
    Module_compile = Module::_compile

    # load Streamline and ensure it registers itself:
    streamline = require 'streamline'
    streamline.register
        fibers: mode is 'fibers'

    # then reset Module::_compile():
    Module::_compile = Module_compile

    # streamline 0.3+ no longer exposes its compiler on the regular returned
    # streamline object, since it depends on the mode now, so we grab that:
    require "streamline/lib/#{mode}/transform"

coffee = loadCoffee()
streamline = loadStreamline()


# =========
# CONSTANTS
# =========

CWD = process.cwd()
CWD_LENGTH = CWD.length

# path to cache directory: this directory can/should be e.g. git-ignored.
# TODO ideally, this would be inside a system temp directory or similar?
# update: should include the CS and streamline versions to support upgrades!
CACHE_PATH = ".cache/#{coffee.VERSION}-#{streamline.version}"


# ==========
# FS HELPERS
# ==========

# synchronously creates the directory at the given path, including all
# intermediate directories, if it doesn't already exist. (like `mkdir -p`)
mkdirpSync = (dir) ->
    # normalize and resolve path to an absolute one:
    # (path.resolve automatically uses the current directory if needed)
    dir = path.resolve path.normalize dir

    # try to create this directory:
    try
        # XXX hardcoding recommended file mode of 511 (0777 in octal)
        # (note that octal numbers are disallowed in ES5 strict mode)
        fs.mkdirSync dir, 511

    # and if we fail, base action based on why we failed:
    catch e
        # XXX Node 0.6 seems to break e.errno -- doesn't match constants
        # anymore! see: http://stackoverflow.com/a/9254101/132978
        switch e.code

            # base case: if the path already exists, we're good to go.
            # TODO account for this path being a file, not a dir?
            when 'EEXIST'
                return

            # recursive case: some directory in the path doesn't exist, so
            # make this path's parent directory.
            when 'ENOENT'
                mkdirpSync path.dirname dir
                mkdirpSync dir

            else
                throw e

# synchronously fetches and returns the last modified time of the file or dir
# at the given path, or 0 if no file or dir exists at this path.
mtimeSync = (path) ->
    try
        fs.statSync(path).mtime
    catch e
        0

readFileSync = (path) ->
    fs.readFileSync path, 'utf8'

writeFileSync = (path, content) ->
    fs.writeFileSync path, content, 'utf8'


# ==========
# MAIN LOGIC
# ==========

# Here's how this works: when you require() any file, Node tells us the full
# absolute path to the file, e.g. /Users/aseemk/Projects/Foo/bar_.coffee or
# /usr/local/lib/node/.npm/foo/bar.js.
#
# When you require() a file that's Coffee and/or Streamline, and we end up
# compiling it, we'll cache the compiled output at the same path as the source
# file, except under our cache directory. E.g. if our cache directory is at
# /path/to/.cache, and you require() a file at /path/to/source.coffee, we'll
# cache the compiled output at /path/to/.cache/path/to/source.coffee.
#
# So now when you require() a file that's Coffee and/or Streamline, we'll
# first check our cache to see if we have an up-to-date compiled copy. If so,
# we'll use that. Otherwise, we'll compile it and cache it. We determine if
# it's up-to-date via the last modified time (mtime).

# make the cache directory if it doesn't already exist
mkdirpSync CACHE_PATH

# helper function: reads and compiles the Coffee and/or Stremaline file at the
# given path, returning the compiled output.
compileSync = (sourcePath) ->
    ext = path.extname sourcePath

    # regardless of type, read in the source file, and assume initially that
    # the source is itself the compiled output.
    source = readFileSync sourcePath
    output = source

    # if the source file is coffee, transform it to JS
    if ext in ['.coffee', '._coffee']
        output = coffee.compile output,
            filename: sourcePath
            bare: true      # to support streamline

    # if the source file is streamlined, transform it to regular.
    # this could be _.js or _.coffee (old), or ._js or ._coffee (new).
    # TODO support file-level options when transforming streamline code.
    if sourcePath.match /(_\.|\._)(js|coffee)$/
        output = streamline.transform output,
            lines: 'preserve'

    # finally, regardless of any transformation, use and return the output
    return output

# main require() handler:
requireSync = (module, sourcePath) ->
    # derive the cached path of this file: cache dir + source path.
    # optimization: if this file is within the current working directory,
    # we'll use a relative source path instead of an absolute one.
    # to prevent collisions, we separate relative paths from absolute ones.
    # (note that path.relative() is only available on node 0.6 onwards, but
    # it's not what we want here anyway; we want to test relativity rather
    # than force it, and we also don't want any ..'s in our path.)
    cachedPath = path.join CACHE_PATH,
        if 0 is sourcePath.indexOf CWD
            path.join 'rel', sourcePath.substr CWD_LENGTH
        else
            path.join 'abs', sourcePath

    # read mtimes of source path and cached path
    sourceMtime = mtimeSync sourcePath
    cachedMtime = mtimeSync cachedPath

    # if the cached copy is up-to-date, use its content
    if cachedMtime >= sourceMtime
        content = readFileSync cachedPath

    # otherwise, compile the source and cache it
    else
        content = compileSync sourcePath

        # make sure the cached copy's directory exists before writing it:
        mkdirpSync path.dirname cachedPath
        writeFileSync cachedPath, content

    # finally, use this content for the require()...
    module._compile content, sourcePath

    # ...but be robust to other tools overwriting our require() hooks, e.g. if
    # coffeescript is included again by a dependendency; reset our hooks in
    # case they were overwritten. this ensures our hooks are always used.
    # XXX this isn't very friendly to other modules; TODO FIXME somehow?
    registerExtensions()

# overwrite the require() handlers for our expected extensions w/ ours above:
do registerExtensions = ->
    for ext in ['.js', '.coffee', '._js', '._coffee']
        require.extensions[ext] = requireSync
