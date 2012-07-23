# example._coffee
# See example.js for an example of loading this efficiently.

# Defer to next tick so that example.js's require() profile prints first:
process.nextTick _

# Then do the standard Streamlined hello world:
console.log 'Hello...'
setTimeout _, 1000
console.log '...world!'
